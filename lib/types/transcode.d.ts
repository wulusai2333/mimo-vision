/**
 * Image transcoding for formats the vision endpoint does not decode natively (SVG/TIFF/HEIC/...).
 * ImageMagick is probed through the optional `ctx.subprocess` seam; the source rides in as a scratch
 * file and the converted PNG rides out as a scratch file, so binary never crosses the seam's
 * text-oriented stdio. When ImageMagick (or the subprocess service) is absent, a clear error is
 * raised rather than a hard failure — native formats never touch this path.
 * @module @deepseek-ai/dsh-tool-vision/src/transcode
 */
import type { Context } from '@deepseek-ai/cordis';
/** Extensions the vision endpoint does not decode natively but ImageMagick can convert to PNG. */
export declare const TRANSCODABLE_EXT: ReadonlySet<string>;
/**
 * Whether a path claims a transcodable (non-native-image) format.
 * @param path - the model-supplied path.
 */
export declare function isTranscodable(path: string): boolean;
/**
 * Convert one image to PNG capped at 2048px on the long edge. The source bytes are written to a
 * scratch file, converted by ImageMagick through the subprocess seam, and the result read back.
 * @param ctx - plugin context carrying the optional subprocess service.
 * @param bytes - the source image bytes.
 * @param signal - aborts the conversion.
 * @returns the PNG bytes.
 */
export declare function transcodeToPng(ctx: Context, bytes: Uint8Array, signal?: AbortSignal): Promise<Uint8Array>;
//# sourceMappingURL=transcode.d.ts.map