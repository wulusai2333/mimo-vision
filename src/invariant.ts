/**
 * Package-owned invariant companion for `mimo-vision`.
 * @module mimo-vision/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'mimo-vision'

/** Cordis companion plugin name. */
export const name = 'tool-vision-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this model-facing bridge has no independent lifecycle stream; execution
 * relations are owned by the capability seams it calls (`ctx.fs` / `ctx.credentials` / `ctx.tools`).
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
