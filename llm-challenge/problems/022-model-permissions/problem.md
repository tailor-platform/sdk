# 022: Model Permissions

## Goal

Create a TailorDB model definition for a **Document** with record-level permissions and GraphQL-level permissions.

## Instructions

Create the file `tailordb/document.ts` that defines a `Document` model with the following fields:

| Field    | Type    | Required | Notes          |
| -------- | ------- | -------- | -------------- |
| title    | string  | yes      |                |
| content  | string  | no       | Optional field |
| ownerId  | uuid    | yes      |                |
| isPublic | boolean | yes      |                |

The model must also include automatic timestamp fields (`createdAt`, `updatedAt`).

### Record-Level Permissions (`.permission()`)

- **create**: Allow when user is logged in
  - Conditions: `[[{ user: "_loggedIn" }, "=", true]]`
  - permit: `true`
- **read**: Allow when document is public OR user is the owner
  - Two permission rules:
    1. Conditions: `[[{ record: "isPublic" }, "=", true]]`, permit: `true`
    2. Conditions: `[[{ record: "ownerId" }, "=", { user: "id" }]]`, permit: `true`
- **update**: Allow when user is the owner (use newRecord)
  - Conditions: `[[{ newRecord: "ownerId" }, "=", { user: "id" }]]`
  - permit: `true`
- **delete**: Allow when user is the owner
  - Conditions: `[[{ record: "ownerId" }, "=", { user: "id" }]]`
  - permit: `true`

### GraphQL-Level Permissions (`.gqlPermission()`)

Two policies:

1. Logged-in users can read and create:
   - Conditions: `[[{ user: "_loggedIn" }, "=", true]]`
   - Actions: `["read", "create"]`
   - permit: `true`
2. Unconditional full access (empty conditions):
   - Conditions: `[]` (empty array)
   - Actions: `"all"`
   - permit: `true`

## Requirements

- The file must have a **named export** `document` (the value)
- The file must also export the **type**: `export type document = typeof document;`

## Reference

Refer to the installed SDK package for model definition and permission patterns.
