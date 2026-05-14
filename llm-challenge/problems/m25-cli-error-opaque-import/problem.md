# Correct the kyselyTypePlugin import path

## Goal

Make `tailor.config.ts` typecheck and produce a registered Kysely plugin. The
file currently imports `kyselyTypePlugin` from a package path that looks
plausible but does not exist; only the SDK's built-in sub-path export
actually resolves the symbol.

## Domain Context

The Tailor SDK exposes its built-in plugins through dedicated sub-path exports
of `@tailor-platform/sdk` (for example, `@tailor-platform/sdk/plugin/seed` and
`@tailor-platform/sdk/plugin/kysely-type`). External-looking names such as
`@tailor-platform/kysely-types` (plural) look very close to the generator's
internal identifier but are not real packages. Picking the wrong one yields a
module-not-found error whose message points only at the bad path, with no
hint that the real export lives under the SDK package.

## What to Build

Edit `tailor.config.ts` so that `kyselyTypePlugin` is imported from the
correct SDK sub-path export. Keep the existing `defineConfig(...)` default
export, the `plugins` export, and the plugin options
(`{ distPath: "./generated/tailordb.ts" }`) unchanged.

## Requirements

- The import path must be exactly `"@tailor-platform/sdk/plugin/kysely-type"`
  (singular `kysely-type`, the SDK sub-path).
- Do not introduce or fall back to the deprecated `defineGenerators(...)` API.
- Do not edit `tailordb/`.

## Reference

Refer to the installed SDK package's `package.json` exports map for available
sub-paths.

## CLI Reference

`packages/sdk/docs/cli-reference.md` lists the plugin sub-paths used by the
CLI; cross-check that resource if a "module not found" error is opaque.
