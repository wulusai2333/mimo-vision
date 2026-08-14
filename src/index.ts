/**
 * The model-facing `describe_image` tool: a vision bridge for the DeepSeek Harness. It reads an
 * image through the `ctx.fs` seam, discovers the opencode key through the `ctx.credentials` seam,
 * sends the image to a mimo-v2.5 vision model (free tier first, paid fallback), and returns the
 * textual description as its canonical output. Registration is a revertible effect — disposing the
 * plugin fiber unregisters the tool.
 * @module @deepseek-ai/dsh-tool-vision
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import { resolveVisionKey } from './key.ts'
import { resolveRoutes } from './routes.ts'
import { isTranscodable, transcodeToPng } from './transcode.ts'
import { callVision, guessMime } from './vision.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-vision'

/** Services the tool consumes through the harness's capability seams. */
export const inject = ['tools', 'fs', 'credentials']

/** Hard cap on bytes read from the filesystem before base64-encoding; beyond this the read fails. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** Deployment-tunable plugin config; every field defaults in code. */
export interface Config {
  /** Whether the paid route may back the free route's failures. Defaults to true. */
  allowPaid?: boolean
  freeBaseUrl?: string
  freeModel?: string
  paidBaseUrl?: string
  paidModel?: string
}

export const Config: z<Config> = z.object({
  allowPaid: z.boolean().default(true),
  freeBaseUrl: z.string(),
  freeModel: z.string(),
  paidBaseUrl: z.string(),
  paidModel: z.string(),
})

/**
 * Resolve a model-supplied path through the filesystem seam, observe absence, and require a regular
 * file. Mirrors the harness's own read-tool target resolution so `describe_image` sees the same
 * execution world (session workspace cwd, sandbox) as `read`/`read_image`.
 * @param ctx - the plugin context providing filesystem resolution and observation events.
 * @param exec - the current tool execution, including session cwd and cancellation.
 * @param requestedPath - the raw path supplied to the tool.
 * @returns the resolved target and its stat result.
 */
async function resolveRegularReadTarget(
  ctx: Context,
  exec: ToolExecution,
  requestedPath: string,
): Promise<{ target: FsTarget; info: FsInfo }> {
  const cwd = exec.agent?.session.header.cwd
  const target = await ctx.fs.resolve(requestedPath, {
    ...cwd !== undefined ? { cwd } : {},
    signal: exec.signal,
  })
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'file') {
    throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  return { target, info }
}

/**
 * Register `describe_image` on `ctx.tools`. The credentials resolver is a thin closure over the
 * seam so key discovery stays per-call: a changed credential reaches the next call without reload.
 * @param ctx - registrant context carrying the tool, filesystem, and credentials services.
 * @param config - the plugin's normalized config (Schemastery has filled defaults).
 */
export function apply(ctx: Context, config: Config): void {
  const routes = resolveRoutes(config)
  const resolveCredential = (ref: string) => ctx.credentials.resolve(credentialRef(ref))

  ctx.tools.register(defineTool({
    name: 'describe_image',
    description: 'Describe an image file using a vision model and return a textual description.',
    parameters: {
      path: { type: 'string', required: true, description: 'Path to the image file.' },
      question: { type: 'string', description: 'Optional question about the image.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    // Read-only remote call with no shared mutable state; concurrent calls cannot conflict.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const nativeMime = guessMime(args.path)
      if (nativeMime === undefined && !isTranscodable(args.path)) {
        throw new Error(
          `cannot describe "${args.path}": only image files are supported `
          + '(PNG/JPEG/GIF/WebP/BMP natively, or SVG/TIFF/HEIC/PSD/ICO/... when ImageMagick is installed)',
        )
      }
      const key = await resolveVisionKey(resolveCredential)
      if (key === undefined) {
        throw new Error(
          'no vision API key found: set OPENCODE_GO_API_KEY or OPENCODE_API_KEY in DSH credentials '
          + '(Settings → Models, or ~/.dsh/.credentials.yaml), or in the process environment.',
        )
      }
      const { target, info } = await resolveRegularReadTarget(ctx, exec, args.path)
      const bytes = await ctx.fs.readBytes(target, exec.signal, MAX_IMAGE_BYTES)
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      const imageBytes = nativeMime === undefined ? await transcodeToPng(ctx, bytes, exec.signal) : bytes
      const mime = nativeMime ?? 'image/png'
      const imageBase64 = Buffer.from(imageBytes).toString('base64')
      return callVision({
        key,
        imageBase64,
        mime,
        ...args.question !== undefined ? { question: args.question } : {},
        routes,
        signal: exec.signal,
      })
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Describe image ${args.path}`,
        kind: 'read',
        locations: [{ path: args.path }],
      }
    },
  }))
}
