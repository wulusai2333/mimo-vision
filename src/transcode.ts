/**
 * Image transcoding for formats the vision endpoint does not decode natively (SVG/TIFF/HEIC/...).
 * ImageMagick is probed through the optional `ctx.subprocess` seam; the source rides in as a scratch
 * file and the converted PNG rides out as a scratch file, so binary never crosses the seam's
 * text-oriented stdio. When ImageMagick (or the subprocess service) is absent, a clear error is
 * raised rather than a hard failure — native formats never touch this path.
 * @module @deepseek-ai/dsh-tool-vision/src/transcode
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

/** Extensions the vision endpoint does not decode natively but ImageMagick can convert to PNG. */
export const TRANSCODABLE_EXT: ReadonlySet<string> = new Set([
  '.svg',
  '.tiff',
  '.tif',
  '.heic',
  '.heif',
  '.psd',
  '.ico',
  '.exr',
  '.jp2',
  '.jxl',
  '.avif',
])

/** Long-edge cap applied during conversion; also bounds the vision token cost. */
const MAX_EDGE = '2048x2048>'

/** Missing-ImageMagick message shared by every fallback arm. */
const NO_MAGICK =
  'this image format requires ImageMagick (magick); install it, or use PNG/JPEG/GIF/WebP/BMP'

/**
 * Whether a path claims a transcodable (non-native-image) format.
 * @param path - the model-supplied path.
 */
export function isTranscodable(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return TRANSCODABLE_EXT.has(path.slice(dot).toLowerCase())
}

/**
 * Convert one image to PNG capped at 2048px on the long edge. The source bytes are written to a
 * scratch file, converted by ImageMagick through the subprocess seam, and the result read back.
 * @param ctx - plugin context carrying the optional subprocess service.
 * @param bytes - the source image bytes.
 * @param signal - aborts the conversion.
 * @returns the PNG bytes.
 */
export async function transcodeToPng(ctx: Context, bytes: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) {
    throw new Error(`${NO_MAGICK} (and the subprocess service)`)
  }
  const magick = await resolveMagick(subprocess, signal)
  const dir = await mkdtemp(join(tmpdir(), 'dsh-vision-'))
  const input = join(dir, 'input')
  const output = join(dir, 'output.png')
  try {
    await writeFile(input, bytes)
    const handle = subprocess.spawn({
      argv: [magick, input, '-resize', MAX_EDGE, '-strip', output],
      cwd: dir,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 1024 },
        stderr: { maxBytes: 8192 },
      },
      graceMs: 10_000,
      signal,
    })
    const outcome = await handle.done
    if (outcome.exitCode !== 0) {
      const stderr = handle.collected.stderr?.readFrom(0).text.trim() ?? ''
      throw new Error(`image conversion failed${stderr ? `: ${stderr}` : ''}`)
    }
    return new Uint8Array(await readFile(output))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Resolve a working ImageMagick executable: `magick` (v7) first, `convert` (v6) as fallback. */
async function resolveMagick(subprocess: SubprocessRuntime, signal?: AbortSignal): Promise<string> {
  try {
    return await subprocess.resolveExecutable('magick', undefined, signal)
  } catch {
    // v6 fallback; reject the Windows NTFS convert.exe name collision.
    let convert: string
    try {
      convert = await subprocess.resolveExecutable('convert', undefined, signal)
    } catch {
      throw new Error(NO_MAGICK)
    }
    if (convert.toLowerCase().includes('system32')) throw new Error(NO_MAGICK)
    return convert
  }
}
