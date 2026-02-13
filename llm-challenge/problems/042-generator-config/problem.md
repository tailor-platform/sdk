# 042: Generator Configuration

## Goal

Create a complete application configuration with generator definitions using `defineConfig` and `defineGenerators`.

## Instructions

A `Product` model is already provided in `tailordb/product.ts` with the following fields:

| Field    | Type   | Required | Notes                                                      |
| -------- | ------ | -------- | ---------------------------------------------------------- |
| name     | string | yes      |                                                            |
| price    | float  | yes      |                                                            |
| category | enum   | yes      | Allowed values: `electronics`, `clothing`, `food`, `other` |

The model also includes automatic timestamp fields (`createdAt`, `updatedAt`).

Create the file `tailor.config.ts` that exports both a configuration and generators.

### Generators

Define a **named export** `generators` using `defineGenerators()` with two generators:

1. `@tailor-platform/kysely-type` with distPath `"./generated/db.ts"`
2. `@tailor-platform/enum-constants` with distPath `"./generated/enums.ts"`

### Config

Define a **default export** using `defineConfig()`:

- name: `"challenge-042"`
- db: `{ tailordb: { files: ["./tailordb/*.ts"] } }`

## Requirements

- Import `defineConfig` and `defineGenerators` from `@tailor-platform/sdk`
- The file must have a **named export** `generators` from `defineGenerators()`
- The file must have a **default export** from `defineConfig()`

## Reference

Refer to the installed SDK package for configuration and generator definition patterns.
