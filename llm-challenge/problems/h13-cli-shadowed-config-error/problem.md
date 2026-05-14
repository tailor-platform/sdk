# Recover from a shadowed config export that hides defineConfig from the CLI

## Goal

`pnpm tailor-sdk generate` fails on the existing project with
`Invalid Tailor config module: default export not found`. The config file has
already wired everything (name, db globs) correctly through `defineConfig(...)`
**except** that the wrapper is bound to a named `config` export instead of
the file's default export, so the SDK config loader cannot find the real
configuration.

Restructure `tailor.config.ts` so that:

1. The default export is **directly** the value returned by `defineConfig(...)`.
2. Existing TailorDB file globs continue to resolve.
3. Generate completes and emits `tailor.d.ts` for the project.

## Domain Context

The SDK's config loader does `await import(configPath)` and reads
`module.default`. A user who exports their config as `export const config = ...`
loses the model wiring even though the module loads and typechecks. The error
message names the missing piece ("default export not found"), so the fix is
mechanical once the solver maps the error to the export shape.

## What to Build

- Edit `tailor.config.ts` so that `defineConfig({ ... })` is itself the
  default export.
- Do not introduce any other top-level exports beyond the default export.
- Do not edit `tailordb/note.ts`.

## Requirements

- After the fix, `pnpm tailor-sdk generate` must complete cleanly.
- `import("./tailor.config.ts").default` must yield an object whose `name` is
  `"micro-challenge"` and whose `db.tailordb.files` array contains
  `"./tailordb/*.ts"`.
- The default export must not be wrapped in another object (no `default.tailor`
  / `default.config` / `default.app` indirection).

## Reference

Refer to the installed SDK package for the config loader's expectations on the
configuration file shape.

## CLI Reference

`packages/sdk/docs/cli-reference.md` describes which file the CLI consults
and how the `-c <path>` flag overrides it. The error message names the
exact missing piece — "default export not found" — so the fix is to align
the export shape, not the CLI invocation.
