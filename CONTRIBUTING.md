# Contributing to mimo-vision

Thanks for your interest! This project follows the DeepSeek Harness (DSH)
plugin conventions. Please read [AGENTS.md](AGENTS.md) first — it documents the
repository structure, the DSH native-plugin paradigm, and the seam rules.

## Repository layout

```
mimo-vision/
├── src/             # TypeScript sources (pure logic + the plugin entry)
├── lib/             # COMMITTED prebuilt artifacts (tsdown output)
├── tests/           # vitest suite
├── adr/             # architecture decision records
├── cordis.patch.yml # bundle patch declared by package.json's dsh.bundle
├── package.json / tsconfig.json
└── README.md / README.zh.md / AGENTS.md / CONTEXT.md
```

## Development environment

The `@deepseek-ai/dsh-*` seams are versioned by the DSH dependency closure,
not by this package. The peer dependencies are marked optional so standalone
install works, but the plugin only runs inside DSH. To typecheck, test, or
build, place the package in the monorepo source tree (see the README "Building
from source" section), or run the prebuilt artifacts directly via `dsh plugin
add`.

Monorepo commands:

```bash
npx tsc -b packages/vision/tool-vision   # typecheck
npx vitest run packages/vision/tool-vision   # unit tests
npx oxlint packages/vision/tool-vision       # lint
```

Inside the package (when the monorepo is installed):

```bash
pnpm run test
pnpm run typecheck   # tsc --build, emits intermediate lib/types/*.js + .d.ts
pnpm run build       # tsc --build, then tsdown emits lib/index.js + lib/invariant.js
```

## Prebuilt `lib/` sync discipline

GitHub-source installs load the committed `lib/` **without building**, so:

- After changing `src/`, always run `pnpm run build` (which runs `tsc --build`
  first) and **commit `lib/`** in the same change. Never commit the
  intermediate `lib/types/*.js` files — they are git-ignored.
- CI enforces this: it fails when the `lib/` last-change commit is not the
  same as (or a descendant of) the `src/` last-change commit (see
  `.github/workflows/ci.yml`).

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new capability
- `fix:` — bug fix
- `docs:` — documentation
- `refactor:` — restructuring without behavior change
- `test:` — tests
- `chore:` — tooling/maintenance

One logical change per commit. Never commit keys or credential files.

## Pull requests

1. Fork the repository and create a feature branch.
2. Make your change, keeping the seam rules from AGENTS.md:
   - files via `ctx.fs`, credentials via `ctx.credentials.resolve`, subprocesses
     via `ctx.subprocess` — nothing hand-rolled in `apply`.
   - keep `@deepseek-ai/*` in `peerDependencies` (never `dependencies`).
3. Rebuild and commit `lib/` if you touched `src/`.
4. Add tests for new behavior (vitest; see the existing `tests/` for the
   fake-seam patterns).
5. Open a PR against `main` with a summary of what changed and why, referencing
   the relevant ADR where applicable.

## Reporting bugs / requesting features

Open an issue describing the expected vs actual behavior, the DSH version, and
a minimal repro. Security issues: see [SECURITY.md](SECURITY.md).
