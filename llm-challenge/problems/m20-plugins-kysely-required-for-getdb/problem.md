# Enable Kysely type generation so a workflow can call getDB("tailordb")

## Goal

Make `workflows/sumInvoices.ts` typecheck and run by enabling the SDK plugin
that generates the typed `getDB` helper for TailorDB. The workflow already
imports `getDB` from `../generated/tailordb`, but nothing produces that file
until the right plugin is wired up.

## Domain Context

Workflow code that queries TailorDB through Kysely needs strongly-typed table
definitions. The SDK delegates this generation to a built-in plugin which
emits a `generated/tailordb.ts` module describing the project's TailorDB
namespace. Without the plugin, `pnpm tailor-sdk generate` skips the file and
the workflow fails to compile.

## What to Build

Edit `tailor.config.ts` to:

1. Add a `plugins` named export that registers `kyselyTypePlugin({ distPath:
"./generated/tailordb.ts" })` through the SDK's plugin composition API.
2. Keep the existing `defineConfig(...)` default export and the `Invoice`
   TailorDB type intact.

Once the plugin is registered, `pnpm tailor-sdk generate` materializes
`generated/tailordb.ts`, the workflow typechecks, and `getDB("tailordb")` is
usable.

## Requirements

- Use the dedicated `@tailor-platform/sdk/plugin/kysely-type` import path for
  the plugin factory.
- Register the plugin via the SDK's plugin composition function (the one
  exported from `@tailor-platform/sdk` that takes plugin instances as rest
  arguments).
- Do not edit `workflows/sumInvoices.ts` or `tailordb/invoice.ts`.
- The generated output path must be `"./generated/tailordb.ts"` exactly so
  the workflow's existing import resolves.

## Reference

Refer to the installed SDK package for the plugin factory's options shape and
the registration function. No external documentation is required for this
task.
