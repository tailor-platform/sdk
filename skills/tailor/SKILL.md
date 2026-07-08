---
name: tailor
description: Use this skill when working with @tailor-platform/sdk projects, including service configuration, CLI usage, and docs navigation.
metadata:
  politty-cli: "@tailor-platform/sdk:tailor"
---

# Tailor SDK Knowledge

This skill helps with projects using `@tailor-platform/sdk`.

## Primary Sources

Use these files as the single source of truth:

- `node_modules/@tailor-platform/sdk/README.md`
- `node_modules/@tailor-platform/sdk/docs/configuration.md`
- `node_modules/@tailor-platform/sdk/docs/services/*.md`
- `node_modules/@tailor-platform/sdk/docs/cli-reference.md`
- `node_modules/@tailor-platform/sdk/docs/cli/*.md`
- `node_modules/@tailor-platform/sdk/docs/testing.md`
- `node_modules/@tailor-platform/sdk/docs/runtime.md`

## Working Rules

1. Prefer SDK docs above assumptions. If behavior is unclear, cite the exact doc path used.
2. Keep examples compatible with Node.js 22+.
3. For CLI questions, verify command and option names from `docs/cli-reference.md` and `docs/cli/*.md`.
4. For configuration questions, validate examples against `docs/configuration.md` and related service docs.

## Quick Navigation

- Setup and first deploy: `docs/quickstart.md`
- Core config shape: `docs/configuration.md`
- Service details: `docs/services/*.md`
- CLI commands: `docs/cli-reference.md` and `docs/cli/*.md`
- Testing patterns: `docs/testing.md`
- Runtime API wrappers (`tailor.iconv`, `tailor.secretmanager`, `tailor.idp`, `tailor.workflow`, `tailor.context`, `tailor.authconnection`, `tailordb.file`): `docs/runtime.md`
