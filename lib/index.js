import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { FsError } from "@deepseek-ai/dsh-fs";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region lib/types/key.js
/**
* Vision API-key resolution over the DSH credentials seam. Pure and dependency-free: the plugin
* wires this to `ctx.credentials.resolve`, so the key is discovered through the harness's own
* layering (process env > `~/.dsh/.credentials.yaml` > `.env`) instead of any hand-rolled file
* parsing. Only the two opencode-compatible references are consulted, in DSH's preferred order.
* @module @deepseek-ai/dsh-tool-vision/src/key
*/
/** Candidate references, most specific first (DSH's opencode-go name, then the official name). */
const OPENCODE_KEY_REFS = ["OPENCODE_GO_API_KEY", "OPENCODE_API_KEY"];
/**
* Resolve the first configured opencode key, in {@link OPENCODE_KEY_REFS} order.
* @param resolve - the credentials-seam resolver to read through.
* @returns the first non-empty key value, or undefined when neither reference is configured.
*/
async function resolveVisionKey(resolve) {
	for (const ref of OPENCODE_KEY_REFS) {
		const value = (await resolve(ref))?.value;
		if (value !== void 0 && value.length > 0) return value;
	}
}
//#endregion
//#region lib/types/routes.js
/**
* Route resolution: the free tier first, the paid tier as a per-call fallback. Every endpoint and
* model is overridable through plugin config; nothing here reads the process environment.
* @module @deepseek-ai/dsh-tool-vision/src/routes
*/
/** Default free tier: opencode Zen, `mimo-v2.5-free`. */
const FREE_ROUTE = {
	label: "free",
	baseUrl: "https://opencode.ai/zen/v1",
	model: "mimo-v2.5-free"
};
/** Default paid tier: opencode Go, `mimo-v2.5`. */
const PAID_ROUTE = {
	label: "paid",
	baseUrl: "https://opencode.ai/zen/go/v1",
	model: "mimo-v2.5"
};
/**
* Resolve the ordered route list for one request. The free route always leads; the paid route is
* appended only while {@link RouteConfig.allowPaid} is not explicitly false.
* @param config - the plugin's normalized config (defaults may already be filled).
* @returns the routes to try, in fallback order.
*/
function resolveRoutes(config) {
	const routes = [{
		label: "free",
		baseUrl: config.freeBaseUrl ?? FREE_ROUTE.baseUrl,
		model: config.freeModel ?? FREE_ROUTE.model
	}];
	if (config.allowPaid !== false) routes.push({
		label: "paid",
		baseUrl: config.paidBaseUrl ?? PAID_ROUTE.baseUrl,
		model: config.paidModel ?? PAID_ROUTE.model
	});
	return routes;
}
/** Per-request wall-clock budget, independent of any caller cancellation. */
const REQUEST_TIMEOUT_MS = 12e4;
/** Extension → declared image media type; anything else is sent as-is with a binary mime. */
const MIME_BY_EXT = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp"
};
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
/**
* Map a file path to its declared image media type by extension.
* @param path - the file path the model supplied.
* @returns the media type, or `application/octet-stream` for an unknown extension.
*/
function guessMime(path) {
	const dot = path.lastIndexOf(".");
	if (dot < 0) return "application/octet-stream";
	return MIME_BY_EXT[path.slice(dot).toLowerCase()] ?? "application/octet-stream";
}
/**
* Build one chat-completions payload; an empty question falls back to {@link DEFAULT_PROMPT}.
* @param model - the vision model id.
* @param imageBase64 - base64-encoded image bytes.
* @param mime - the image media type.
* @param question - optional caller question, overriding the default prompt.
* @returns the JSON-serializable request body.
*/
function buildPayload(model, imageBase64, mime, question) {
	return {
		model,
		messages: [{
			role: "user",
			content: [{
				type: "text",
				text: (question ?? "").trim() || "Describe this image in detail: main subjects, people, objects, actions, composition, colors, mood, and all visible text. Point out notable details."
			}, {
				type: "image_url",
				image_url: { url: `data:${mime};base64,${imageBase64}` }
			}]
		}]
	};
}
/**
* Project the description text out of a chat-completions response body.
* @param data - the parsed response JSON.
* @returns the textual content.
* @throws when the body lacks `choices[0].message.content`.
*/
function extractContent(data) {
	const content = data?.choices?.[0]?.message?.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const text = content.filter((part) => typeof part === "object" && part !== null).map((part) => part.text).filter((t) => typeof t === "string").join("");
		if (text.length > 0) return text;
	}
	throw new Error("vision response is missing choices[0].message.content");
}
/**
* Send the image to each route in order until one succeeds (free first, paid as fallback).
* @param request - the resolved key, image, and ordered routes.
* @returns the vision model's textual description.
* @throws with an actionable message when every route fails; rethrows caller cancellation.
*/
async function callVision(request) {
	const failures = [];
	let rejectedByAuth = false;
	for (const route of request.routes) try {
		return await callRoute(route, request);
	} catch (error) {
		if (request.signal?.aborted) throw error;
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("401")) rejectedByAuth = true;
		failures.push(message);
	}
	if (rejectedByAuth) throw new Error("vision API key was rejected (401). Set OPENCODE_GO_API_KEY or OPENCODE_API_KEY in DSH credentials (Settings → Models, or ~/.dsh/.credentials.yaml), or in the process environment.");
	const last = failures[failures.length - 1] ?? "no routes configured";
	throw new Error(`all vision routes failed: ${last}`);
}
/** POST one route and extract its description, folding cancellation and timeout into clear errors. */
async function callRoute(route, request) {
	const url = route.baseUrl.replace(/\/+$/, "") + "/chat/completions";
	const payload = buildPayload(route.model, request.imageBase64, request.mime, request.question);
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	const signal = request.signal === void 0 ? timeout : AbortSignal.any([request.signal, timeout]);
	let response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${request.key}`,
				"Content-Type": "application/json",
				"User-Agent": BROWSER_UA
			},
			body: JSON.stringify(payload),
			signal
		});
	} catch (error) {
		if (request.signal?.aborted) throw error;
		if (timeout.aborted) throw new Error(`vision request timed out after ${REQUEST_TIMEOUT_MS} ms`);
		throw new Error(`vision request failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
	let data;
	try {
		data = await response.json();
	} catch {
		throw new Error("vision response is not valid JSON");
	}
	return extractContent(data);
}
//#endregion
//#region lib/types/index.js
/**
* The model-facing `describe_image` tool: a vision bridge for the DeepSeek Harness. It reads an
* image through the `ctx.fs` seam, discovers the opencode key through the `ctx.credentials` seam,
* sends the image to a mimo-v2.5 vision model (free tier first, paid fallback), and returns the
* textual description as its canonical output. Registration is a revertible effect — disposing the
* plugin fiber unregisters the tool.
* @module @deepseek-ai/dsh-tool-vision
*/
/** Cordis plugin name used by loader diagnostics. */
const name = "tool-vision";
/** Services the tool consumes through the harness's capability seams. */
const inject = [
	"tools",
	"fs",
	"credentials"
];
/** Hard cap on bytes read from the filesystem before base64-encoding; beyond this the read fails. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const Config = z.object({
	allowPaid: z.boolean().default(true),
	freeBaseUrl: z.string(),
	freeModel: z.string(),
	paidBaseUrl: z.string(),
	paidModel: z.string()
});
/**
* Resolve a model-supplied path through the filesystem seam, observe absence, and require a regular
* file. Mirrors the harness's own read-tool target resolution so `describe_image` sees the same
* execution world (session workspace cwd, sandbox) as `read`/`read_image`.
* @param ctx - the plugin context providing filesystem resolution and observation events.
* @param exec - the current tool execution, including session cwd and cancellation.
* @param requestedPath - the raw path supplied to the tool.
* @returns the resolved target and its stat result.
*/
async function resolveRegularReadTarget(ctx, exec, requestedPath) {
	const cwd = exec.agent?.session.header.cwd;
	const target = await ctx.fs.resolve(requestedPath, {
		...cwd !== void 0 ? { cwd } : {},
		signal: exec.signal
	});
	const info = await ctx.fs.stat(target, exec.signal);
	if (info === void 0) {
		ctx.emit("fs/observed", target, { kind: "absent" }, exec);
		throw new FsError(`cannot read "${target.displayPath}": not found`, "FS_NOT_FOUND");
	}
	if (info.type !== "file") throw new FsError(`cannot read "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
	return {
		target,
		info
	};
}
/**
* Register `describe_image` on `ctx.tools`. The credentials resolver is a thin closure over the
* seam so key discovery stays per-call: a changed credential reaches the next call without reload.
* @param ctx - registrant context carrying the tool, filesystem, and credentials services.
* @param config - the plugin's normalized config (Schemastery has filled defaults).
*/
function apply(ctx, config) {
	const routes = resolveRoutes(config);
	const resolveCredential = (ref) => ctx.credentials.resolve(credentialRef(ref));
	ctx.tools.register(defineTool({
		name: "describe_image",
		description: "Describe an image file using a vision model and return a textual description.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "Path to the image file."
			},
			question: {
				type: "string",
				description: "Optional question about the image."
			}
		},
		output: {
			schema: { type: "string" },
			render: (_args, value) => [{
				type: "text",
				text: value
			}]
		},
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			const key = await resolveVisionKey(resolveCredential);
			if (key === void 0) throw new Error("no vision API key found: set OPENCODE_GO_API_KEY or OPENCODE_API_KEY in DSH credentials (Settings → Models, or ~/.dsh/.credentials.yaml), or in the process environment.");
			const { target, info } = await resolveRegularReadTarget(ctx, exec, args.path);
			const bytes = await ctx.fs.readBytes(target, exec.signal, MAX_IMAGE_BYTES);
			ctx.emit("fs/observed", target, {
				kind: "present",
				version: info.version
			}, exec);
			return callVision({
				key,
				imageBase64: Buffer.from(bytes).toString("base64"),
				mime: guessMime(args.path),
				...args.question !== void 0 ? { question: args.question } : {},
				routes,
				signal: exec.signal
			});
		},
		presentCall(args) {
			return {
				card: "generic",
				title: `Describe image ${args.path}`,
				kind: "read",
				locations: [{ path: args.path }]
			};
		}
	}));
}
//#endregion
export { Config, apply, inject, name };
