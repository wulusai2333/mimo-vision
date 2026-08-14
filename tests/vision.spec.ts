import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveVisionKey } from '../src/key.ts'
import { resolveRoutes } from '../src/routes.ts'
import { isTranscodable } from '../src/transcode.ts'
import { buildPayload, callVision, DEFAULT_PROMPT, extractContent, guessMime } from '../src/vision.ts'
import type { VisionRequest } from '../src/vision.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveRoutes', () => {
  it('defaults to free first with paid as fallback', () => {
    expect(resolveRoutes({})).toEqual([
      { label: 'free', baseUrl: 'https://opencode.ai/zen/v1', model: 'mimo-v2.5-free' },
      { label: 'paid', baseUrl: 'https://opencode.ai/zen/go/v1', model: 'mimo-v2.5' },
    ])
  })

  it('drops the paid route when allowPaid is false', () => {
    expect(resolveRoutes({ allowPaid: false })).toEqual([
      { label: 'free', baseUrl: 'https://opencode.ai/zen/v1', model: 'mimo-v2.5-free' },
    ])
  })

  it('applies the endpoint and model overrides', () => {
    expect(resolveRoutes({
      freeBaseUrl: 'https://example.com/free',
      freeModel: 'free-model',
      paidBaseUrl: 'https://example.com/paid',
      paidModel: 'paid-model',
    })).toEqual([
      { label: 'free', baseUrl: 'https://example.com/free', model: 'free-model' },
      { label: 'paid', baseUrl: 'https://example.com/paid', model: 'paid-model' },
    ])
  })
})

describe('resolveVisionKey', () => {
  it('prefers OPENCODE_GO_API_KEY', async () => {
    const resolve = vi.fn(async (ref: string) => {
      if (ref === 'OPENCODE_GO_API_KEY') return { value: 'sk-go', source: 'file' }
      if (ref === 'OPENCODE_API_KEY') return { value: 'sk-official', source: 'file' }
      return undefined
    })
    expect(await resolveVisionKey(resolve)).toBe('sk-go')
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('falls back to OPENCODE_API_KEY when the DSH name is unset', async () => {
    const resolve = vi.fn(async (ref: string) =>
      ref === 'OPENCODE_API_KEY' ? { value: 'sk-official', source: 'file' } : undefined)
    expect(await resolveVisionKey(resolve)).toBe('sk-official')
    expect(resolve).toHaveBeenCalledWith('OPENCODE_GO_API_KEY')
    expect(resolve).toHaveBeenCalledWith('OPENCODE_API_KEY')
  })

  it('skips empty values and returns undefined when nothing is configured', async () => {
    const resolve = vi.fn(async () => ({ value: '', source: 'file' }))
    expect(await resolveVisionKey(resolve)).toBeUndefined()
  })
})

describe('guessMime', () => {
  it('maps the supported extensions case-insensitively', () => {
    expect(guessMime('a.png')).toBe('image/png')
    expect(guessMime('a.JPG')).toBe('image/jpeg')
    expect(guessMime('b.jpeg')).toBe('image/jpeg')
    expect(guessMime('c.gif')).toBe('image/gif')
    expect(guessMime('d.WebP')).toBe('image/webp')
    expect(guessMime('e.BMP')).toBe('image/bmp')
  })

  it('returns undefined for unknown or missing extensions', () => {
    expect(guessMime('notes.txt')).toBeUndefined()
    expect(guessMime('no-extension')).toBeUndefined()
  })
})

describe('isTranscodable', () => {
  it('recognizes ImageMagick-convertible formats', () => {
    expect(isTranscodable('a.svg')).toBe(true)
    expect(isTranscodable('b.TIFF')).toBe(true)
    expect(isTranscodable('c.heic')).toBe(true)
    expect(isTranscodable('d.psd')).toBe(true)
  })

  it('excludes native formats, other files, and missing extensions', () => {
    expect(isTranscodable('a.png')).toBe(false)
    expect(isTranscodable('a.jpg')).toBe(false)
    expect(isTranscodable('notes.txt')).toBe(false)
    expect(isTranscodable('no-extension')).toBe(false)
  })
})

describe('buildPayload', () => {
  it('embeds the prompt and the base64 data URL', () => {
    const payload = buildPayload('mimo-v2.5-free', 'YWJj', 'image/png', 'What color is this?')
    expect(payload.model).toBe('mimo-v2.5-free')
    expect(payload.messages[0]!.content).toEqual([
      { type: 'text', text: 'What color is this?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' } },
    ])
  })

  it('uses the default prompt when the question is empty', () => {
    const payload = buildPayload('m', 'x', 'image/png', '   ')
    expect(payload.messages[0]!.content[0]).toEqual({ type: 'text', text: DEFAULT_PROMPT })
  })
})

describe('extractContent', () => {
  it('returns a string content', () => {
    expect(extractContent({ choices: [{ message: { content: 'a cat' } }] })).toBe('a cat')
  })

  it('joins array-part content', () => {
    expect(extractContent({ choices: [{ message: { content: [{ text: 'a ' }, { text: 'cat' }] } }] })).toBe('a cat')
  })

  it('throws when content is missing', () => {
    expect(() => extractContent({ choices: [] })).toThrow(/missing choices\[0\]\.message\.content/)
  })
})

describe('callVision', () => {
  function request(routes: VisionRequest['routes']): VisionRequest {
    return { key: 'sk-x', imageBase64: 'YWJj', mime: 'image/png', routes }
  }

  it('returns the first route that succeeds', async () => {
    const routes = resolveRoutes({})
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'free ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })))
    expect(await callVision(request(routes))).toBe('free ok')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('falls back to the paid route after a free-route failure', async () => {
    const routes = resolveRoutes({})
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      calls.push(String(url))
      if (String(url).includes('/zen/v1')) {
        return new Response('bad gateway', { status: 502 })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'paid ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))
    expect(await callVision(request(routes))).toBe('paid ok')
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('opencode.ai/zen/v1/chat/completions')
    expect(calls[1]).toContain('opencode.ai/zen/go/v1/chat/completions')
  })

  it('gives an actionable message when every route is rejected with 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(callVision(request(resolveRoutes({})))).rejects.toThrow(/rejected \(401\)/)
  })
})
