# Validate resolver input against a TailorDB type's field validators

## Goal

Define a `Subscription` TailorDB type with **type-level field validators** for
its `plan` and `price` fields, and a `createSubscription` mutation resolver that
parses each input value through those validators and reports the outcome as a
structured response.

## Domain Context

A billing service accepts subscription proposals over GraphQL. Each proposal
must satisfy domain invariants (a known `plan` name and a non-negative `price`),
but the resolver still needs to surface every offending field so that the
frontend can render inline form errors instead of falling back to a generic
"something went wrong" toast.

Re-implementing the validation logic inside the resolver body would duplicate
the rules already encoded on the TailorDB type. Instead, the resolver should
delegate to the type's per-field `parse()` entry points and collect any issues
the validators emit.

## What to Build

The prewired `tailor.config.ts` globs `./tailordb/*.ts` for TailorDB types and
`./resolvers/*.ts` for resolvers. Complete two files:

1. `tailordb/subscription.ts` — exports a `subscription` model named
   `"Subscription"` with the fields and type-level validators below. **Do not
   call `.validate(...)` on the individual field chains**; attach the rules at
   the type level via `.validate({...})`.

   | Field | Kind   | Validator                                                                        |
   | ----- | ------ | -------------------------------------------------------------------------------- |
   | plan  | string | accepts only `"basic"`, `"pro"`, or `"enterprise"`; message `"plan not allowed"` |
   | price | float  | rejects negative values (`>= 0`); message `"price must be >= 0"`                 |

2. `resolvers/createSubscription.ts` — default-exports a `createResolver(...)`
   mutation named `"createSubscription"` that:
   - Accepts input `{ plan: string; price: float }` via `t.string()` and
     `t.float()`.
   - Returns the typed object `{ success: boolean; errors: string[] }` using
     `t.object({ success: t.bool(), errors: t.string({ array: true }) })`.
   - In the body, parses each input value through the corresponding TailorDB
     field's `parse({ value, data, user })` API. Concatenate every validator
     issue's `message` across both fields into the `errors` array (preserving
     field order: `plan` first, then `price`). `success` is `true` when
     `errors.length === 0`.
   - Never throws; even invalid input returns a `{ success: false, errors }`
     payload.

## Requirements

- The resolver must import the `subscription` model from
  `../tailordb/subscription` and call its `fields.plan.parse(...)` and
  `fields.price.parse(...)` helpers. Do not duplicate the validation predicates
  inside the resolver body.
- Use `t.string({ array: true })` (not a tuple type) for the `errors` field.
- Do not register hooks, descriptions, or permissions on the TailorDB type.
- Do not edit `tailor.config.ts`.

## Reference

Refer to the installed SDK package for the `db.type(...).validate(...)` tuple
shape, the `field.parse(...)` return value (`{ issues?: Issue[] }`), and
`createResolver` / `t.*` builders. No external documentation is required for
this task.
