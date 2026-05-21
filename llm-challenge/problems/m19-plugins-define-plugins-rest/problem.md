# Register two SDK plugins via the rest-argument plugin composition function

## Goal

Wire two built-in `@tailor-platform/sdk` plugins into the application config in
a single call. The SDK exposes a consolidated registration API that takes
plugin instances as rest arguments — use that API, not its deprecated
predecessor.

## Domain Context

A typical project enables several built-in generators side-by-side (Kysely
types, seed scaffolding, enum constants, file helpers). When the project
matures, copy-pasted import lists and ad-hoc generator arrays drift out of
sync. The SDK now exposes a single function that accepts plugin instances
directly, so the configuration stays declarative and order-explicit.

## What to Build

Edit `tailor.config.ts` so that it exports a `plugins` constant that bundles
two plugin instances **in this order**:

1. `kyselyTypePlugin({ distPath: "./generated/tailordb.ts" })`
2. `seedPlugin({ distPath: "./seed", machineUserName: "runner" })`

Each plugin must come from its dedicated SDK sub-path
(`@tailor-platform/sdk/plugin/kysely-type` and
`@tailor-platform/sdk/plugin/seed`). Compose them with the SDK's plugin
composition function — the single function exported from
`@tailor-platform/sdk` that takes plugin instances as rest arguments.

The existing `defineConfig(...)` default export (with name `"micro-challenge"`,
the auth definition, the static website array, and the `db.tailordb.files`
glob) is already in place. Do not change it; only add the `plugins` export
and the necessary imports.

## Requirements

- Use **one** call to register both plugins — pass them as separate arguments,
  not inside an array literal.
- Do not introduce the deprecated `defineGenerators(...)` API.
- The exported `plugins` constant must contain exactly two entries in the
  order specified above.
- Keep the existing default export and `auth` named export intact.

## Reference

Refer to the installed SDK package for the plugin composition function and
each plugin's options shape. No external documentation is required for this
task.
