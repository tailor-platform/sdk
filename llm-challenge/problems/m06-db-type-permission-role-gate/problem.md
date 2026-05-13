# Gate Audit records by role

## Goal

Define an `Audit` TailorDB model with a single `message` string field and attach a record-level permission that:

- Allows any **logged-in user** to `create` and `read`.
- Allows only users whose `role` attribute equals `"ADMIN"` to `update` and `delete`.

## Domain Context

Audit log entries are visible and append-only for everyone in the workspace, but mutation and deletion are reserved for administrators. Each action's policy is expressed as a tuple condition `[operand, operator, operand]`. Operands include `{ user: "_loggedIn" }`, `{ user: "role" }`, etc.

## What to Build

The prewired `tailor.config.ts` globs `./tailordb/*.ts`. Complete `tailordb/audit.ts` so that it exports an `audit` model named `"Audit"` with the field below and the four-action permission policy described in Requirements.

| Field   | Kind   |
| ------- | ------ |
| message | string |

This challenge does **not** wire up a full auth service, so the `role` attribute is not registered in the ambient `AttributeMap`. Use the `TailorTypePermission<User>` type (re-exported from `@tailor-platform/sdk`) with a local `User` type such as `{ id: string; role: string }` to opt into the additional attribute when building the permission value.

## Requirements

- Use `db.type(...).permission(...)` with all four actions (`create`, `read`, `update`, `delete`) populated.
- Each action's policy must include `permit: true`.
- `create` and `read` must use the condition `[{ user: "_loggedIn" }, "=", true]`.
- `update` and `delete` must use the condition `[{ user: "role" }, "=", "ADMIN"]`.
- Each condition is the inner tuple wrapped in the `conditions` array (object policy form, not bare-array form).
- Do not introduce extra fields, hooks, or descriptions for this exercise.

## Reference

Refer to the installed SDK package for the permission policy shape, the available operand keys (`user`, `_loggedIn`, etc.), the operator literal, and the `TailorTypePermission<User>` generic that widens the `user.*` operand to your custom attributes. No external documentation is required for this task.
