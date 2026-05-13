# Define a composite index on the Order model

## Goal

Define an `Order` TailorDB model with `status` and `createdAt` fields and attach a non-unique composite index spanning both columns in that order.

## Domain Context

Operational dashboards query orders by status sorted by creation time, so the model needs a multi-column index that covers both columns to keep the lookup performant.

## What to Build

The prewired `tailor.config.ts` globs `./tailordb/*.ts`. Complete `tailordb/order.ts` so that it exports an `order` model named `"Order"` with the fields below and a single composite index over `["status", "createdAt"]`.

| Field     | Kind     |
| --------- | -------- |
| status    | string   |
| createdAt | datetime |

## Requirements

- Use `db.type(...).indexes(...)` to declare the index at the type level.
- The index must list `["status", "createdAt"]` in that order.
- The index must be non-unique (`unique: false`).
- Do not introduce extra fields, hooks, validators, or descriptions for this exercise.

## Reference

Refer to the installed SDK package for the `indexes(...)` argument shape and how composite indexes are described. No external documentation is required for this task.
