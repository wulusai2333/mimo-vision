import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as tool from '../src/index.ts'

/** 1x1 red PNG. */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')

const testToolSignal = new AbortController().signal

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-tool-vision-'))
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(dir, { recursive: true, force: true })
})

/** In-memory credentials fake; keys are raw reference names, values are secret strings. */
function fakeCredentials(entries: Record<string, string>) {
  return {
    resolve: async (ref: string) => {
      const value = entries[ref]
      return value === undefined ? undefined : { value, source: 'file' }
    },
    describe: async () => ({ configured: true, writable: false }),
    set: async () => {},
    unset: async () => {},
  }
}

/** The calling agent: only the session workspace cwd matters to `describe_image`. */
function agent(cwd = dir): object {
  return { options: {}, session: { header: { cwd } } }
}

interface SetupOptions {
  credentials?: Record<string, string>
  config?: tool.Config
}

async function setup(options: SetupOptions = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  ctx.provide('credentials', fakeCredentials(options.credentials ?? { OPENCODE_GO_API_KEY: 'sk-go' }) as never)
  await ctx.plugin(tool, options.config ?? {})
  return ctx
}

let callCounter = 0
function describeImage(ctx: Context, args: unknown, caller?: object) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`desc-${++callCounter}`),
    name: 'describe_image',
    arguments: args,
    ...caller ? { agent: caller as never } : {},
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

function stubVision(content: string, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })))
}

describe('describe_image registration', () => {
  it('registers a tool with a string output schema', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === 'describe_image')
    expect(schema).toBeDefined()
    expect(schema!.parameters).toMatchObject({
      type: 'object',
      properties: {
        path: { type: 'string' },
        question: { type: 'string' },
      },
      required: ['path'],
    })
  })

  it('presents a read-family card with a follow-along location', async () => {
    const ctx = await setup()
    expect(ctx.tools.get('describe_image')?.presentCall?.({ path: 'shot.png' })).toEqual({
      card: 'generic',
      title: 'Describe image shot.png',
      kind: 'read',
      locations: [{ path: 'shot.png' }],
    })
  })

  it('declares itself parallel-safe', async () => {
    const ctx = await setup()
    expect(ctx.tools.executionMode({
      signal: testToolSignal,
      callId: CallId('desc-parallel'),
      name: 'describe_image',
      arguments: { path: 'a.png' },
    })).toEqual({ kind: 'parallel' })
  })

  it('unregisters when its plugin fiber is disposed (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(LocalFileSystem, { cwd: dir })
    ctx.provide('credentials', fakeCredentials({ OPENCODE_GO_API_KEY: 'sk-go' }) as never)
    const fiber = await ctx.plugin(tool, {})
    expect(ctx.tools.schemas().some(s => s.name === 'describe_image')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'describe_image')).toBe(false)
  })

  it('has the namespace-plugin export shape (no default, name/inject/apply preserved)', () => {
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-vision')
    expect(tool.inject).toEqual(['tools', 'fs', 'credentials'])
    expect(typeof tool.apply).toBe('function')
  })
})

describe('describe_image execution', () => {
  it('reads the image through ctx.fs and returns the vision model text', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    stubVision('a 1x1 red pixel')
    const ctx = await setup()
    const result = await describeImage(ctx, { path: 'red.png' }, agent())
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected describe_image success')
    expect(result.value).toBe('a 1x1 red pixel')
    expect(text(result)).toBe('a 1x1 red pixel')
  })

  it('resolves a relative path against the calling session workspace cwd', async () => {
    // The fs default cwd is `dir` (no image here), but the agent's session cwd is `sessionDir`
    // (the image lives here). A relative path must follow the session cwd, not the fs default.
    const sessionDir = join(dir, 'session')
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, 'cat.png'), PNG_1X1)
    stubVision('a cat')
    const ctx = await setup()
    const result = await describeImage(ctx, { path: 'cat.png' }, agent(sessionDir))
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected describe_image success')
    expect(text(result)).toBe('a cat')
  })

  it('emits fs/observed with the present observation after a successful read', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    stubVision('ok')
    const ctx = await setup()
    const observed: { path: string; kind: string }[] = []
    ctx.on('fs/observed', (target, observation) => {
      void observed.push({ path: target.displayPath, kind: observation.kind })
    })
    await describeImage(ctx, { path: 'red.png' }, agent())
    expect(observed).toEqual([{ path: join(dir, 'red.png'), kind: 'present' }])
  })

  it('fails with an actionable message when no opencode key is configured', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    stubVision('unreachable')
    const ctx = await setup({ credentials: {} })
    const result = await describeImage(ctx, { path: 'red.png' }, agent())
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no vision API key found')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('prefers OPENCODE_GO_API_KEY over OPENCODE_API_KEY', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string> | undefined)?.Authorization ?? '')
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))
    const ctx = await setup({
      credentials: { OPENCODE_GO_API_KEY: 'sk-go', OPENCODE_API_KEY: 'sk-official' },
    })
    await describeImage(ctx, { path: 'red.png' }, agent())
    expect(seen).toEqual(['Bearer sk-go'])
  })

  it('falls back to OPENCODE_API_KEY when the DSH name is unset', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string> | undefined)?.Authorization ?? '')
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))
    const ctx = await setup({ credentials: { OPENCODE_API_KEY: 'sk-official' } })
    await describeImage(ctx, { path: 'red.png' }, agent())
    expect(seen).toEqual(['Bearer sk-official'])
  })

  it('reports a missing file and a directory through the fs vocabulary', async () => {
    await mkdir(join(dir, 'folder.png'))
    stubVision('unreachable')
    const ctx = await setup()

    const missing = await describeImage(ctx, { path: 'absent.png' }, agent())
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('not found')

    const directory = await describeImage(ctx, { path: 'folder.png' }, agent())
    expect(directory.isError).toBe(true)
    expect(text(directory)).toContain('not a regular file')

    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns an isError result when every vision route fails', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })))
    const ctx = await setup()
    const result = await describeImage(ctx, { path: 'red.png' }, agent())
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('all vision routes failed')
  })

  it('rejects a non-image extension before any network or file I/O', async () => {
    await writeFile(join(dir, 'notes.txt'), 'hello')
    stubVision('unreachable')
    const ctx = await setup()
    const result = await describeImage(ctx, { path: 'notes.txt' }, agent())
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('only BMP/GIF/JPEG/PNG/WebP')
    expect(fetch).not.toHaveBeenCalled()
  })
})
