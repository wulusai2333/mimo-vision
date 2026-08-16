# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-16

First stable release. Ready for `dsh plugin add mimo-vision` (npm registry)
and `dsh plugin add github:wulusai2333/mimo-vision` (source).

### Fixed

- Removed the dead `./src/*` export from `package.json` (the published tarball
does not ship `src/`).
- `pnpm run build` now runs `tsc --build` before tsdown, so a clean checkout
has the intermediate `lib/types/*.js` entry points that tsdown consumes.
- Marked every `@deepseek-ai/*` peer dependency as optional via
`peerDependenciesMeta`, so `pnpm add` / `npm install` of the published tarball
succeeds outside the DSH dependency closure (the closure still provides the
singleton seams at runtime).
- Added an `engines` field declaring Node `^22.19.0 || >=24.0.0`.
- Git-ignored the intermediate `lib/types/*.js` artifacts emitted by `tsc`.
- Published `lib/types/**/*.d.ts.map` in the tarball so declaration source
mapping URLs resolve.
- Hardened CI: ancestor-based lib/src sync guard and a tarball install smoke
test.
- Corrected README/AGENTS/CONTRIBUTING statements about `@deepseek-ai/*` npm
availability and documented the `.tif` / `.heif` transcodable aliases.

## [0.1.0-rc.5] - 2026-08-15

Release candidate. DeepSeek Harness (DSH) native plugin registering the
`describe_image` tool — a vision bridge (image → mimo-v2.5 → text description)
for text-only main models.

### Added

- `describe_image(path, question?)` tool registered through `ctx.tools.register`
  (reversible: dispose unregisters tool and schema).
- Native image passthrough: PNG / JPEG / GIF / WebP / BMP.
- Auto-transcoding of SVG / TIFF / HEIC / PSD / ICO / EXR / JP2 / JXL / AVIF to
  PNG via ImageMagick (`ctx.subprocess` seam), downscaled to ≤2048px long edge.
- Route fallback: free Zen (`mimo-v2.5-free`) first, paid Go (`mimo-v2.5`) on
  failure once per request; `allowPaid: false` disables the paid fallback.
- Configurable `freeBaseUrl` / `freeModel` / `paidBaseUrl` / `paidModel`.
- Credentials via the `ctx.credentials` seam (`OPENCODE_GO_API_KEY` →
  `OPENCODE_API_KEY`); files via the `ctx.fs` seam (20 MiB read cap).
- Prebuilt `lib/` artifacts committed for GitHub-source installs (no build step,
  no `allowBuilds`).
- Test suite (vitest): key resolution order, route fallback, payload/extraction,
  registration schema, HMR uninstall, `fs/observed`, and error paths.
- ADR-0002 documenting the DSH native-plugin design (supersedes the MCP approach,
  ADR-0001).

### Fixed

- `dsh plugin --profile web add github:wulusai2333/mimo-vision` install path
  (reconciled as a profile bundle layer).
- Vision route config fields marked optional to match the interface and README.
- Reverted `z.string().optional()` to `z.string()` — Schemastery object fields
  are optional by default and have no `.optional()`.

### Changed

- Package renamed from `@deepseek-ai/dsh-tool-vision` to `mimo-vision`.
- Rewritten as a DSH native plugin (ADR-0002), replacing the earlier
  cross-tool vision MCP server implementation.
- Uninstall documented: `dsh plugin --profile web remove mimo-vision` (by
  package name, not install source).

[0.1.0]: https://github.com/wulusai2333/mimo-vision/releases/tag/v0.1.0
[0.1.0-rc.5]: https://github.com/wulusai2333/mimo-vision/releases/tag/v0.1.0-rc.5
