/**
 * Vision API-key resolution over the DSH credentials seam. Pure and dependency-free: the plugin
 * wires this to `ctx.credentials.resolve`, so the key is discovered through the harness's own
 * layering (process env > `~/.dsh/.credentials.yaml` > `.env`) instead of any hand-rolled file
 * parsing. Only the two opencode-compatible references are consulted, in DSH's preferred order.
 * @module mimo-vision/src/key
 */
/** Candidate references, most specific first (DSH's opencode-go name, then the official name). */
export declare const OPENCODE_KEY_REFS: readonly ["OPENCODE_GO_API_KEY", "OPENCODE_API_KEY"];
/** Structural face of the credentials seam's resolve result; only `value` is read. */
export interface CredentialResolution {
    value: string;
    source?: string;
}
/**
 * Resolver a credentials provider exposes: one reference in, its current value out (absent when
 * unconfigured). Matches `CredentialProvider.resolve` after `credentialRef` branding.
 */
export type CredentialResolver = (ref: string) => Promise<CredentialResolution | undefined>;
/**
 * Resolve the first configured opencode key, in {@link OPENCODE_KEY_REFS} order.
 * @param resolve - the credentials-seam resolver to read through.
 * @returns the first non-empty key value, or undefined when neither reference is configured.
 */
export declare function resolveVisionKey(resolve: CredentialResolver): Promise<string | undefined>;
//# sourceMappingURL=key.d.ts.map