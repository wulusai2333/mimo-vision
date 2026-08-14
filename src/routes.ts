/**
 * Route resolution: the free tier first, the paid tier as a per-call fallback. Every endpoint and
 * model is overridable through plugin config; nothing here reads the process environment.
 * @module @deepseek-ai/dsh-tool-vision/src/routes
 */

import type { VisionRoute } from './types.ts'

/** Default free tier: opencode Zen, `mimo-v2.5-free`. */
export const FREE_ROUTE: VisionRoute = {
  label: 'free',
  baseUrl: 'https://opencode.ai/zen/v1',
  model: 'mimo-v2.5-free',
}

/** Default paid tier: opencode Go, `mimo-v2.5`. */
export const PAID_ROUTE: VisionRoute = {
  label: 'paid',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  model: 'mimo-v2.5',
}

/** Deployment-tunable route config; every field defaults in code, so all are optional. */
export interface RouteConfig {
  /** Whether the paid route may back the free route's failures. Defaults to true. */
  allowPaid?: boolean
  freeBaseUrl?: string
  freeModel?: string
  paidBaseUrl?: string
  paidModel?: string
}

/**
 * Resolve the ordered route list for one request. The free route always leads; the paid route is
 * appended only while {@link RouteConfig.allowPaid} is not explicitly false.
 * @param config - the plugin's normalized config (defaults may already be filled).
 * @returns the routes to try, in fallback order.
 */
export function resolveRoutes(config: RouteConfig): VisionRoute[] {
  const free: VisionRoute = {
    label: 'free',
    baseUrl: config.freeBaseUrl ?? FREE_ROUTE.baseUrl,
    model: config.freeModel ?? FREE_ROUTE.model,
  }
  const routes: VisionRoute[] = [free]
  if (config.allowPaid !== false) {
    routes.push({
      label: 'paid',
      baseUrl: config.paidBaseUrl ?? PAID_ROUTE.baseUrl,
      model: config.paidModel ?? PAID_ROUTE.model,
    })
  }
  return routes
}
