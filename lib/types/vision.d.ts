/**
 * The vision HTTP call: OpenAI-compatible chat completions against an opencode Zen route, image as
 * a base64 data URL, textual description back out. Uses the global `fetch` (Node 22+), forwards the
 * caller's abort signal, and applies its own per-request timeout. Pure helpers (`guessMime`,
 * `buildPayload`, `extractContent`) are exported for direct unit testing.
 * @module @deepseek-ai/dsh-tool-vision/src/vision
 */
import type { VisionRoute } from './types.ts';
/** Prompt used when the caller supplies no question. */
export declare const DEFAULT_PROMPT: string;
/** Per-request wall-clock budget, independent of any caller cancellation. */
export declare const REQUEST_TIMEOUT_MS = 120000;
/**
 * Map a file path to its declared image media type by extension.
 * @param path - the file path the model supplied.
 * @returns the media type, or `application/octet-stream` for an unknown extension.
 */
export declare function guessMime(path: string): string;
/** Wire payload of one chat-completions request: a text prompt plus one image data URL. */
export interface ChatPayload {
    model: string;
    messages: Array<{
        role: 'user';
        content: Array<{
            type: 'text';
            text: string;
        } | {
            type: 'image_url';
            image_url: {
                url: string;
            };
        }>;
    }>;
}
/**
 * Build one chat-completions payload; an empty question falls back to {@link DEFAULT_PROMPT}.
 * @param model - the vision model id.
 * @param imageBase64 - base64-encoded image bytes.
 * @param mime - the image media type.
 * @param question - optional caller question, overriding the default prompt.
 * @returns the JSON-serializable request body.
 */
export declare function buildPayload(model: string, imageBase64: string, mime: string, question?: string): ChatPayload;
/**
 * Project the description text out of a chat-completions response body.
 * @param data - the parsed response JSON.
 * @returns the textual content.
 * @throws when the body lacks `choices[0].message.content`.
 */
export declare function extractContent(data: unknown): string;
/** Inputs for one vision round-trip. */
export interface VisionRequest {
    key: string;
    imageBase64: string;
    mime: string;
    question?: string;
    routes: VisionRoute[];
    signal?: AbortSignal;
}
/**
 * Send the image to each route in order until one succeeds (free first, paid as fallback).
 * @param request - the resolved key, image, and ordered routes.
 * @returns the vision model's textual description.
 * @throws with an actionable message when every route fails; rethrows caller cancellation.
 */
export declare function callVision(request: VisionRequest): Promise<string>;
//# sourceMappingURL=vision.d.ts.map