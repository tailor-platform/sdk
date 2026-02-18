# 010: Fix Broken Model

## Goal

Fix a broken TailorDB model definition for an **Employee** model. The scaffold contains multiple intentional errors that must be corrected.

## Instructions

The file `tailordb/employee.ts` is provided but contains several bugs. Find and fix all of them.

The correct Employee model should have:

| Field      | Type     | Required | Notes                                             |
| ---------- | -------- | -------- | ------------------------------------------------- |
| name       | string   | yes      |                                                   |
| department | enum     | yes      | Values: `engineering`, `sales`, `marketing`, `hr` |
| salary     | integer  | yes      | Must have validation: value >= 0                  |
| hireDate   | datetime | yes      |                                                   |
| isActive   | boolean  | no       | Optional                                          |

The model must also include automatic timestamp fields.

## Broken Code

```typescript
import { db } from "@tailor-platform/sdk";

export const employee = db.type("Employe", {
  name: db.string(),
  department: db.str(),
  salary: db.integer(),
  hireDate: db.date(),
  isActive: db.bool({ optional: true }),
  ...db.fields.timestamps(),
});
```

## Requirements

- The file must have a **named export** `employee` (the value)
- The file must also export the **type**: `export type employee = typeof employee;`
- The model name must be `"Employee"` (typo fix)
- `department` must be an enum field, not a string
- `salary` must use the correct integer method and include validation
- `hireDate` must use the correct datetime method
- All field types must use correct SDK API methods

## Reference

Refer to the installed SDK package for model definition patterns and validation API.
