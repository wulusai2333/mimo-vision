//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `mimo-vision`.
* @module mimo-vision/invariant
*/
const PACKAGE_NAME = "mimo-vision";
/** Cordis companion plugin name. */
const name = "tool-vision-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: this model-facing bridge has no independent lifecycle stream; execution
* relations are owned by the capability seams it calls (`ctx.fs` / `ctx.credentials` / `ctx.tools`).
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
