/**
 * The vision HTTP call: OpenAI-compatible chat completions against an opencode Zen route, image as
 * a base64 data URL, textual description back out. Uses the global `fetch` (Node 22+), forwards the
 * caller's abort signal, and applies its own per-request timeout. Pure helpers (`guessMime`,
 * `buildPayload`, `extractContent`) are exported for direct unit testing.
 * @module mimo-vision/src/vision
 */

import type { VisionRoute } from './types.ts'

/** Prompt used when the caller supplies no question. */
export const DEFAULT_PROMPT =
  'Describe this image in detail: main subjects, people, objects, actions, composition, colors, '
  + 'mood, and all visible text. Point out notable details.'

/** Per-request wall-clock budget, independent of any caller cancellation. */
export const REQUEST_TIMEOUT_MS = 120_000

/** Extension → declared image media type, the supported set the vision endpoint actually decodes. */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/126.0 Safari/537.36'

/**
 * Map a file path to its declared image media type by extension.
 * @param path - the file path the model supplied.
 * @returns the media type, or `undefined` when the path does not claim a supported image format.
 */
export function guessMime(path: string): string | undefined {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return undefined
  return MIME_BY_EXT[path.slice(dot).toLowerCase()]
}

/** Wire payload of one chat-completions request: a text prompt plus one image data URL. */
export interface ChatPayload {
  model: string
  messages: Array<{
    role: 'user'
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >
  }>
}

/**
 * Build one chat-completions payload; an empty question falls back to {@link DEFAULT_PROMPT}.
 * @param model - the vision model id.
 * @param imageBase64 - base64-encoded image bytes.
 * @param mime - the image media type.
 * @param question - optional caller question, overriding the default prompt.
 * @returns the JSON-serializable request body.
 */
export function buildPayload(model: string, imageBase64: string, mime: string, question?: string): ChatPayload {
  const prompt = (question ?? '').trim() || DEFAULT_PROMPT
  return {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
      ],
    }],
  }
}

/**
 * Project the description text out of a chat-completions response body.
 * @param data - the parsed response JSON.
 * @returns the textual content.
 * @throws when the body lacks `choices[0].message.content`.
 */
export function extractContent(data: unknown): string {
  const root = data as { choices?: Array<{ message?: { content?: unknown } }> } | null | undefined
  const content = root?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is Record<string, unknown> => typeof part === 'object' && part !== null)
      .map(part => part.text)
      .filter((t): t is string => typeof t === 'string')
      .join('')
    if (text.length > 0) return text
  }
  throw new Error('vision response is missing choices[0].message.content')
}

/** Inputs for one vision round-trip. */
export interface VisionRequest {
  key: string
  imageBase64: string
  mime: string
  question?: string
  routes: VisionRoute[]
  signal?: AbortSignal
}

/**
 * Send the image to each route in order until one succeeds (free first, paid as fallback).
 * @param request - the resolved key, image, and ordered routes.
 * @returns the vision model's textual description.
 * @throws with an actionable message when every route fails; rethrows caller cancellation.
 */
export async function callVision(request: VisionRequest): Promise<string> {
  const failures: string[] = []
  let rejectedByAuth = false
  for (const route of request.routes) {
    try {
      return await callRoute(route, request)
    } catch (error) {
      if (request.signal?.aborted) throw error // caller cancellation: never retry another route
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('401')) rejectedByAuth = true
      failures.push(message)
    }
  }
  if (rejectedByAuth) {
    throw new Error(
      'vision API key was rejected (401). Set OPENCODE_GO_API_KEY or OPENCODE_API_KEY in DSH '
      + 'credentials (Settings → Models, or ~/.dsh/.credentials.yaml), or in the process environment.',
    )
  }
  const last = failures[failures.length - 1] ?? 'no routes configured'
  throw new Error(`all vision routes failed: ${last}`)
}

/** POST one route and extract its description, folding cancellation and timeout into clear errors. */
async function callRoute(route: VisionRoute, request: VisionRequest): Promise<string> {
  const url = route.baseUrl.replace(/\/+$/, '') + '/chat/completions'
  const payload = buildPayload(route.model, request.imageBase64, request.mime, request.question)
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout])

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.key}`,
        'Content-Type': 'application/json',
        'User-Agent': BROWSER_UA,
      },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    if (request.signal?.aborted) throw error
    if (timeout.aborted) throw new Error(`vision request timed out after ${REQUEST_TIMEOUT_MS} ms`)
    throw new Error(`vision request failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error('vision response is not valid JSON')
  }
  return extractContent(data)
}
