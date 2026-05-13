# Attach a type-level validate rule with a custom error message

## Goal

Define a `Product` TailorDB model that exposes a `price` float field and attach a validator at the type level so that parsing a negative price produces the error message `"price must be >= 0"`.

## Domain Context

A storefront catalog cannot accept negative prices. The validation must run when a value is parsed through the model and produce a stable, human-readable error message that downstream tooling can display.

## What to Build

The prewired `tailor.config.ts` globs `./tailordb/*.ts`. Complete `tailordb/product.ts` so that it exports a `product` model named `"Product"` with the field below, and so that the validator below is attached at the type level (not on the field chain itself).

| Field | Kind  | Options                        |
| ----- | ----- | ------------------------------ |
| price | float | rejects negative values (>= 0) |

Required validator behavior:

- A non-negative price (`>= 0`) must pass.
- Any negative price must fail and the failure must carry the message `"price must be >= 0"` verbatim.

## Requirements

- Use `db.type(...).validate(...)` to attach the rule. The validator must be configured at the model level, not via a chained `.validate(...)` on the float field itself.
- Use the `[predicate, message]` tuple form so the error message ships as a string.
- Do not introduce extra fields, hooks, or descriptions for this exercise.

## Reference

Refer to the installed SDK package for the validator tuple shape and where `validate` sits in the TailorDB chain. No external documentation is required for this task.
