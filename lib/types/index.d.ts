/**
 * The model-facing `describe_image` tool: a vision bridge for the DeepSeek Harness. It reads an
 * image through the `ctx.fs` seam, discovers the opencode key through the `ctx.credentials` seam,
 * sends the image to a mimo-v2.5 vision model (free tier first, paid fallback), and returns the
 * textual description as its canonical output. Registration is a revertible effect — disposing the
 * plugin fiber unregisters the tool.
 * @module mimo-vision
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "tool-vision";
/** Services the tool consumes through the harness's capability seams. */
export declare const inject: string[];
/** Deployment-tunable plugin config; every field defaults in code. */
export interface Config {
    /** Whether the paid route may back the free route's failures. Defaults to true. */
    allowPaid?: boolean;
    freeBaseUrl?: string;
    freeModel?: string;
    paidBaseUrl?: string;
    paidModel?: string;
}
export declare const Config: z<Config>;
/**
 * Register `describe_image` on `ctx.tools`. The credentials resolver is a thin closure over the
 * seam so key discovery stays per-call: a changed credential reaches the next call without reload.
 * @param ctx - registrant context carrying the tool, filesystem, and credentials services.
 * @param config - the plugin's normalized config (Schemastery has filled defaults).
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map