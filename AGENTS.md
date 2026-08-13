# Repository Guidelines

## Project Overview

mimo-vision is a cross-tool vision MCP server. It runs over stdio with JSON-RPC 2.0, exposes the `describe_image(path, question?)` tool, auto-discovers API keys from the current agent toolchain (DSH / opencode with the DSH source checked first), and prefers the free Zen route with the paid Go route as fallback. Runtime is Python 3 with **zero third-party dependencies**.

## Project Structure & Module Organization

```
mimo-vision/
├── adr/                  # Architecture Decision Records, numbered
│   └── 0001-cross-tool-vision-mcp-auto-apikey.md
├── tests/                # Unit tests (unittest, stdlib)
├── vision_server.py      # MCP server entry point (repo root)
├── CONTEXT.md            # Domain glossary
├── README.md             # Usage & configuration
└── AGENTS.md
```

- Source lives in a single `vision_server.py` at the repo root; keep it stdlib-only so it runs on Windows / WSL / macOS / Linux without modification.
- Tests go in `tests/`; assets are not stored — images are processed by path and never persisted.

## Build, Test, and Development Commands

There is no build step or dependency install.

- `python vision_server.py` — start the MCP server over stdio.
- `python -m unittest discover -s tests` — run the full test suite.
- `python -c "import vision_server"` — smoke-check syntax/imports.

## Coding Style & Naming Conventions

- Python: PEP 8, 4-space indentation, `snake_case` for functions/variables.
- Environment variables: `UPPER_SNAKE_CASE` (e.g., `OPENCODE_API_KEY`).
- ADR files: `NNNN-kebab-case-slug.md` in `adr/`; update the status line when a decision is superseded.
- No linter/formatter is configured; prefer simple, dependency-free stdlib code.

## Testing Guidelines

- Framework: stdlib `unittest`.
- Files: `test_*.py`; methods: `test_<behavior>`.
- Cover the key-discovery fallback order, malformed/unreadable auth files (must skip silently), route fallback on 4xx/5xx, and `MIMO_VISION_BASE_URL` / `MIMO_VISION_MODEL` overrides.

## Commit & Pull Request Guidelines

The repository has no history yet; adopt Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`. Keep one logical change per commit. Pull requests should state what changed and why, link the relevant ADR, and call out any environment/config changes. Never include API keys or auth-file contents in commits, diffs, or PR descriptions.

## Security & Configuration Tips

- Read only the exact auth files listed in ADR-0001 (including `~/.dsh/.credentials.yaml`); never print, write, upload, or scan for keys.
- Key precedence: `OPENCODE_API_KEY` > `OPENCODE_GO_API_KEY`, then auto-discovery in this order: `~/.dsh/.credentials.yaml` (OPENCODE_GO_API_KEY → OPENCODE_API_KEY) > `~/.local/share/opencode/auth.json`.
- Resolve paths with `os.path.expanduser` only; do not hardcode WSL/Windows paths.

## Agent-Specific Instructions

Codex, Claude Code, and opencode consume this server, so keep the `describe_image(path, question?)` protocol stable — existing `config.toml` registrations must keep working.
