# mimo-vision · Native vision plugin for DSH

**mimo-vision** is a native plugin for **DeepSeek Harness (DSH)**, package name `mimo-vision`. It registers a `describe_image` tool that sends an image to a mimo-v2.5-series multimodal model and returns the **text description** to the main model — a "vision bridge" built for main models (e.g. `deepseek-v4-flash`) that have no vision input of their own.

It is not a standalone process: it is a first-class citizen of DSH's "everything is a plugin" model. `apply` does exactly one thing — registers the capability as a first-class dsh tool. Dependencies, files, credentials, and subprocesses all go through dsh's defined capability seams; uninstalling cleans up cleanly.

### Implementation paradigm: a direct landing of DSH's native plugin primitives

- **Registration is reversible by construction**: `apply(ctx)` contains a single `ctx.tools.register(defineTool(...))`. `register()` returns a disposer; when the plugin fiber disposes, the tool is unregistered and its schema is automatically withdrawn from the system prompt. There is no leftover cleanup code — clean uninstall is a **structural guarantee**, not hand-written cleanup.
- **`inject` declares dependencies**: `export const inject = ['tools', 'fs', 'credentials']` follows the pure Cordis effect spec — activation only happens once the seams are in place. `ctx.get('subprocess')` in `transcode.ts` is an optional capability with a default fallback, used at execution time, not activation time. This is "declared dependencies", not "probed dependencies".
- **All capabilities go through dsh seams**: file reads use `ctx.fs.resolve/stat/readBytes` + `ctx.emit('fs/observed')`; credentials use `ctx.credentials.resolve(credentialRef(...))` with no hand-rolled parsing; subprocess (transcoding) uses `ctx.subprocess`. The one exception: transcode temp files are written via `node:fs` to the system temp directory (see Known Limitations below).
- **Uninstallable / composable**: uninstall is pure — the disposer runs and everything is reclaimed: no disk writes, no timers, no long-lived connections to manually wind down.

## Tool

| Tool | Arguments | Description |
|---|---|---|
| `describe_image` | `path` (required), `question` (optional) | Describes an image file and returns text |

Supported image formats:

- **Sent natively**: PNG / JPEG / GIF / WebP / BMP (all verified decodable by the vision model)
- **Auto-transcoded**: SVG / TIFF / HEIC / PSD / ICO / EXR / JP2 / JXL / AVIF — when ImageMagick is installed locally, these are transcoded to PNG before sending, downscaled to a ≤2048px long edge (saves tokens)
- Any other extension, or a transcode-format when ImageMagick is not installed, returns an explicit error (never sent silently)

Usage example (tell the model): `Use describe_image to describe D:\photos\cat.png, focusing on what breed of cat it is`.

## How it works

1. **Key resolution**: `ctx.credentials.resolve` takes the first non-empty of `OPENCODE_GO_API_KEY` → `OPENCODE_API_KEY` (DSH credential layering: process env > `~/.dsh/.credentials.yaml` > `.env`).
2. **Read the image**: `ctx.fs.resolve` (relative paths resolve against the session workspace cwd) → `ctx.fs.readBytes` (20 MiB cap); non-native formats (SVG/TIFF/HEIC…) are transcoded to PNG via ImageMagick (through the `ctx.subprocess` seam) and downscaled to a 2048px long edge → base64.
3. **Routing**: the free Zen route (`mimo-v2.5-free`) is tried first; on failure (non-2xx / timeout) it falls back to the paid Go route (`mimo-v2.5`) once per request; `allowPaid: false` disables the paid fallback.

Design decisions are documented in [adr/0002-dsh-native-plugin.md](adr/0002-dsh-native-plugin.md) (which supersedes the earlier MCP approach, ADR-0001).

---

## Quick install (npm-installed DSH, recommended)

> For `npx @deepseek-ai/dsh web` or a globally installed DSH. The repo ships **prebuilt artifacts** (`lib/index.js`) — no build toolchain required.

**Prerequisite**: Node `^22.19 || >=24`, and DSH already able to start.

### Step 0 · Install and activate (one command)

mimo-vision declares `dsh.bundle` (see the `dsh` field in `package.json`), so `dsh plugin add` reconciles it as a bundle layer of the profile — **installing the package, mounting the layer, and activating the tool happen in one step**:

```bash
dsh plugin --profile web add github:wulusai2333/mimo-vision
```

> If the repo is not on its default branch, use `github:wulusai2333/mimo-vision#<branch-or-tag>`.
> This path relies on the **dependency closure** that DSH maintains in `~/.dsh/profiles/node_modules` (symlinking all `@deepseek-ai/*` seams to the dsh install tree), so the plugin's runtime `import "@deepseek-ai/dsh-tools"` etc. resolves to the **same instance DSH uses** — singleton-safe, `register()`/`inject` semantics unchanged.
> GitHub-source installs require this repo to commit a **prebuilt `lib/`** (kept in sync with `src/`): pnpm installs the source with `lib/` included, no build runs, no `allowBuilds` needed.

<details>
<summary>Offline / manual mount from source (fallback path when pnpm is unavailable)</summary>

Manually copy the artifacts into the profile's plugin resolution root, then mount the patch in the profile's `cordis.patch.yml` (equivalent to automatic bundle mounting, but two manual steps):

```powershell
# Windows PowerShell
$dst = "$env:USERPROFILE\.dsh\profiles\node_modules\mimo-vision"
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Copy-Item package.json -Destination $dst -Force
Copy-Item cordis.patch.yml -Destination $dst -Force
Copy-Item lib -Destination $dst -Recurse -Force
```

```bash
# macOS / Linux
dst="$HOME/.dsh/profiles/node_modules/mimo-vision"
mkdir -p "$dst"
cp package.json "$dst/"
cp cordis.patch.yml "$dst/"
cp -r lib "$dst/"
```

Then edit `~/.dsh/profiles/web/cordis.patch.yml` and add:

```yaml
- insert:
    - id: tool-vision
      name: 'mimo-vision'
      config:
        allowPaid: true
```

</details>

### Step 1 · Configure the key

Put an opencode key in `~/.dsh/.credentials.yaml` (`OPENCODE_GO_API_KEY` preferred, `OPENCODE_API_KEY` as fallback):

```yaml
OPENCODE_GO_API_KEY: sk-...
```

> You can also put it in the environment of the process that starts DSH (`OPENCODE_GO_API_KEY=... dsh web`). Credential seam layering priority: process env > `.credentials.yaml` > `.env`.

### Step 2 · Restart and verify

**A restart is required on first integration** (so the process `import`s the new package). After that, changes to this plugin's code or config such as `allowPaid` hot-reload without restart.

After restarting, verify: `mimo-vision` should appear in DSH's settings, with `describe_image` among the available tools; or just tell the model "use describe_image to describe some image" and try it.

### Uninstall

`dsh plugin remove` takes the **package name** (the key in the profile's `dependencies`), not the install source:

```bash
dsh plugin --profile web remove mimo-vision
```

> Passing `github:wulusai2333/mimo-vision` errors with `ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS` ("no such dependency found") — the dependency is recorded by package name `mimo-vision`, so `remove` needs that key. The command removes both the dependency and the bundle layer.

---

## Configuration (all optional, defaults provided)

| Field | Default | Description |
|---|---|---|
| `allowPaid` | `true` | Whether to fall back to the paid route after the free route fails |
| `freeBaseUrl` | `https://opencode.ai/zen/v1` | Free route base URL |
| `freeModel` | `mimo-v2.5-free` | Free route model |
| `paidBaseUrl` | `https://opencode.ai/zen/go/v1` | Paid route base URL |
| `paidModel` | `mimo-v2.5` | Paid route model |

A minimal registration only sets `allowPaid`; everything else uses the defaults:

```yaml
- insert:
    - id: tool-vision
      name: 'mimo-vision'
      config:
        allowPaid: false
```

---

## Building from source / development (DSH monorepo)

To modify the plugin source, put it into the DSH source tree and go through the repo gates:

```bash
# 1. Copy this repo as packages/vision/tool-vision
cp -r /path/to/mimo-vision <dsh>/deepseek-harness/packages/vision/tool-vision

# 2. Install and verify (tsc typecheck + vitest unit tests + oxlint)
cd <dsh>/deepseek-harness
pnpm install
npx tsc -b packages/vision/tool-vision   # typecheck
npx vitest run packages/vision/tool-vision   # unit tests
npx oxlint packages/vision/tool-vision       # lint

# 3. Produce lib/index.js (prebuilt artifacts)
cd packages/vision/tool-vision
npx tsdown lib/types/index.js lib/types/invariant.js \
  --out-dir lib --format esm --platform node --target es2024 --fixed-extension false
```

> Steps 2/3 can also be run inside the package with `pnpm run test` / `pnpm run typecheck` / `pnpm run build` (the scripts are in `package.json`).

> Note: the `@deepseek-ai/dsh-*` internal packages are not published to npm, so the plugin cannot be installed standalone via `npm install`; either use the prebuilt artifacts from "Quick install" above, or run it from source inside the monorepo.

## Failure semantics

Any failure (no key, unsupported format, both routes failing, file missing / not a regular file, over the limit, non-image response) is returned as a **tool-level error**: `execute` throws, the registry materializes `isError`, the process does not exit and the session does not break.

## Known Limitations

- **Transcode temp files bypass the `ctx.fs` sandbox**: when non-native formats (SVG/TIFF/HEIC…) are transcoded via ImageMagick, the source bytes and the resulting PNG go through `node:fs` to the system temp directory (`os.tmpdir()`), because `ctx.subprocess` needs real OS paths to feed the local `magick`, while `ctx.fs`'s `FsTarget` may be an abstract/remote/sandboxed path. This bypasses the `dsh-fs-sandbox` file sandbox policy; the temp directory is deleted immediately after conversion. It only triggers when ImageMagick is installed locally **and** a transcode format is requested — native formats (PNG/JPEG/GIF/WebP/BMP) never take this path.
- **The prebuilt `lib/` must stay in sync with `src/`**: GitHub-source installs load the committed `lib/index.js` directly and never build at install time. After changing `src/`, rebuild and commit `lib/`, or the deployed version loads stale artifacts.

## Security

- The key is only read via `ctx.credentials.resolve` — never printed, never written to disk, never directory-scanned;
- The key is only used in the request header `Authorization: Bearer ...`;
- Images are read into memory via `ctx.fs` and sent straight as base64, never written to disk (non-native formats are routed through the system temp dir during transcoding and deleted immediately after).

## License

MIT
