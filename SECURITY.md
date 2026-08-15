# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities.

Report privately via GitHub's [Private vulnerability reporting](https://github.com/wulusai2333/mimo-vision/security/advisories/new)
for this repository (preferred), or email the maintainer directly if that is
unavailable.

Please include:

- The affected version(s) and the DSH profile/plugin setup used.
- A description of the vulnerability and its impact.
- A minimal reproduction, if possible.

You should receive a response within 7 days. Please allow time for a fix and a
release before public disclosure.

## Security posture of this plugin

- The API key is only read via `ctx.credentials.resolve` — never printed,
  written to disk, or directory-scanned; it is used only in the
  `Authorization: Bearer ...` request header.
- Images are read into memory via `ctx.fs` and sent as base64 without touching
  disk. Transcoding (non-native formats) routes through the system temp
  directory and is deleted immediately after conversion.
- Known limitation: transcode temp files bypass the `ctx.fs` sandbox (see the
  README "Known Limitations"). This only triggers when ImageMagick is installed
  locally **and** a transcode-only format is requested.

## Scope

This policy covers the `mimo-vision` plugin code. The DeepSeek Harness host and
the `@deepseek-ai/*` seams have their own security processes.
