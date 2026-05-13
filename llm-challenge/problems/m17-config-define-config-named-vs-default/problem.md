# Default-export a tailor.config wrapped in defineConfig

## Goal

Author `tailor.config.ts` so its **default export** is the value returned by
`defineConfig(...)`, wiring up a single TailorDB model from
`tailordb/customer.ts`.

## Domain Context

A new service is bootstrapping its Tailor configuration. The repository
convention is that every `tailor.config.ts` must call `defineConfig` so the
SDK's type checks and downstream generators see a known shape — a plain
object literal that happens to match the structure is not allowed.

## What to Build

Write `tailor.config.ts` at the project root with the following properties:

- `name`: `"micro-challenge"`
- A `db.tailordb.files` glob pointing at `./tailordb/*.ts`

The file must default-export the result of calling `defineConfig` with that
configuration. The `Customer` TailorDB model is already provided at
`tailordb/customer.ts`.

## Requirements

- The `tailor.config.ts` source must import `defineConfig` from
  `@tailor-platform/sdk`.
- The default export must be the return value of `defineConfig(...)`. Do not
  default-export a plain object literal.
- `name` must equal `"micro-challenge"`.
- Do not edit `tailordb/customer.ts`.

## Reference

Refer to the installed SDK package for the `defineConfig` signature. No
external documentation is required for this task.
