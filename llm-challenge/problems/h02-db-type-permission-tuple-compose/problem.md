# Compose two AND-ed conditions in a single update permission policy

## Goal

Define a `Document` TailorDB model whose record-level `update` permission only
admits the request when **both** of two conditions hold simultaneously:

1. the calling user is the owner of the document (record's `ownerId` matches
   `user.id`), **and**
2. the calling user's `role` attribute equals `"editor"`.

Both conditions must live inside the same policy entry so that the platform
evaluates them as a logical AND.

## Domain Context

`Document` records are owned by a single user. Editors can revise documents
they own, but viewers — even when they own a document — must not be able to
update it. A single permission entry expresses this by stacking two tuple
conditions inside one `conditions` array; if you split them into two policy
entries the platform interprets them as OR, which would silently let any
editor update any document.

## What to Build

The prewired `tailor.config.ts` globs `./tailordb/*.ts`. Complete
`tailordb/document.ts` so that it exports a `document` model named
`"Document"` with the fields below and a record-level permission whose
`update` action contains exactly one policy entry whose `conditions` array
holds two tuples (one per condition).

| Field   | Kind   |
| ------- | ------ |
| title   | string |
| ownerId | string |

Other actions (`create`, `read`, `delete`) must each be filled with a single
permissive policy so the permission value is well-formed; only `update` needs
the composed condition described above.

This challenge does not wire up a full auth service, so the `role` attribute
is not registered in the ambient `AttributeMap`. Use the
`TailorTypePermission<User>` generic re-exported from `@tailor-platform/sdk`
with a local `User` type such as `{ id: string; role: string }` to widen the
`user.*` operand to your custom attributes.

## Requirements

- Use `db.type(...).permission<User>(...)` with all four actions populated.
- The `update` action must have **exactly one** policy entry, and that
  entry's `conditions` array must contain **two** tuple conditions:
  - one comparing the record's `ownerId` to the calling user's `id`
    (use the `newRecord` operand, not `record`, because `update` uses the
    update variant), and
  - one comparing the calling user's `role` to the literal `"editor"`.
- `create`, `read`, and `delete` actions each have a single policy with
  `permit: true` and an empty `conditions: []` array (no extra gating).
- Use the object policy form (`{ conditions: [...], permit: true }`), not
  the bare-array shorthand.
- Do not introduce extra fields, hooks, validators, or descriptions.

## Reference

Refer to the installed SDK package for the permission policy shape, the
`update`-specific operand keys (`newRecord` / `oldRecord` vs. `record`),
and the `TailorTypePermission<User>` generic that widens the `user.*`
operand to custom attributes. No external documentation is required.
