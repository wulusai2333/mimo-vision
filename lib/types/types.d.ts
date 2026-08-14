/**
 * Shared shape vocabulary for the vision bridge. Types only — no runtime code.
 * @module mimo-vision/src/types
 */
/** Discriminator naming which tier a route belongs to. */
export type RouteLabel = 'free' | 'paid';
/** One vision endpoint: a `(baseUrl, model)` pair on the opencode Zen surface. */
export interface VisionRoute {
    /** Which cost tier this route belongs to (drives ordering and fallback). */
    label: RouteLabel;
    /** Base URL of the OpenAI-compatible chat completions endpoint. */
    baseUrl: string;
    /** Vision model id served by this route. */
    model: string;
}
//# sourceMappingURL=types.d.ts.map