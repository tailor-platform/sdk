# Handle nullable inputs in update hooks across multiple fields

## Goal

Define a `Document` TailorDB model with three fields, and attach **type-level
update hooks** to all three fields that survive null input by substituting a
field-specific fallback before normalizing the value.

## Domain Context

A collaborative editor persists `Document` records. Each PATCH request only
includes the fields the user actually changed, so any subset of fields may
arrive as `null` at the update hook boundary. The platform still needs to:

- normalize the title (trim whitespace, never store `null`),
- canonicalize the slug to lowercase even when the user did not retype it, and
- monotonically increment a `version` counter on every update, treating a
  missing prior value as `0`.

A hook that assumes its incoming `value` is non-null will throw at runtime the
moment a partial update lands.

## What to Build

The prewired `tailor.config.ts` globs `./tailordb/*.ts`. Complete
`tailordb/document.ts` so that it exports a `document` model named
`"Document"` with the fields below and an `update` hook attached to each
field at the type level (not on the individual field chain).

| Field   | Kind   | Update hook behaviour                                   |
| ------- | ------ | ------------------------------------------------------- |
| title   | string | trim the value; if missing, return an empty string      |
| slug    | string | lowercase the value; if missing, return an empty string |
| version | int    | return `value + 1`; if missing, treat the prior as `0`  |

## Requirements

- Use `db.type(...).hooks(...)` to attach the hooks at the type level. Do not
  call `.hooks(...)` on the individual fields directly.
- Every `update` hook **must** handle the case where its `value` argument is
  absent (the platform delivers `null` for fields the client omitted).
- Do not register `create` hooks; only `update` is required for this exercise.
- Do not introduce extra fields, validators, descriptions, or permissions.

## Reference

Refer to the installed SDK package for the hook handler signature and the type
of `value` inside an `update` hook. No external documentation is required for
this task.
