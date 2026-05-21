# Aggregate TailorDB rows from a workflow job via the generated getDB helper

## Goal

Implement a workflow job that returns the total `amount` of `Invoice` records
grouped by `accountId`. The aggregation must happen through the SDK's
typed Kysely query builder (`getDB("tailordb")`), which only becomes available
once the right plugin is wired up.

## Domain Context

A billing workflow needs to compute per-account invoice totals. The platform
exposes TailorDB tables through a generated Kysely interface, but the generated
module only exists when the project explicitly opts in via the
`kyselyTypePlugin` plugin. Without that plugin the workflow's `getDB` import
cannot resolve and the build fails.

## What to Build

Two edits are required:

1. **`tailor.config.ts`** — register `kyselyTypePlugin` via the SDK's plugin
   composition API and emit the generated module to
   `"./generated/tailordb.ts"`. Keep the existing `defineConfig(...)` default
   export, the `Invoice` TailorDB type, and the workflow `files` glob intact.
2. **`workflows/sumByAccount.ts`** — implement a workflow job named
   `"sum-invoices-by-account"` whose body uses `getDB("tailordb")` to sum
   `Invoice.amount` grouped by `accountId`. The job must return an array of
   `{ accountId: string; total: number }` objects. Wrap the job in a default
   exported `createWorkflow(...)` whose `mainJob` is that job.

## Requirements

- Use the dedicated `@tailor-platform/sdk/plugin/kysely-type` import path for
  the plugin factory.
- Register the plugin via the SDK's plugin composition function (the one
  exported from `@tailor-platform/sdk` that takes plugin instances as rest
  arguments).
- The generated output path must be `"./generated/tailordb.ts"` exactly so
  the workflow's import resolves.
- The workflow file must export the job as a named export (call it
  `sumInvoicesByAccount`) **and** default-export the surrounding
  `createWorkflow(...)`.
- Aggregate via Kysely's `fn.sum("amount")` aliased as `total` and group by
  `accountId`. Cast `total` to `Number` before returning so the output is a
  plain number, not a string.
- The job factory exported from `@tailor-platform/sdk` is named
  `createWorkflowJob` exactly — shorter aliases such as `createJob` are not
  exported.
- Do not edit `tailordb/invoice.ts`.

## Reference

Refer to the installed SDK package for the plugin factory's options shape, the
workflow APIs, and the shape of the generated Kysely interface. No external
documentation is required for this task.
