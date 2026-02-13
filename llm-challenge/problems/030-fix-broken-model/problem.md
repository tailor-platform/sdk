# 030: Fix Broken Model

## Goal

Fix a broken TailorDB model definition for an **Employee** model. The scaffold contains intentional errors that must be corrected.

## Instructions

The file `tailordb/employee.ts` is provided but contains several bugs:

1. The model name string doesn't match the export name convention (should be `"Employee"`)
2. The `department` field uses a non-existent `db.str()` method (should be `db.string()`)
3. The `salary` field uses `db.integer()` (should be `db.int()`)
4. The `hireDate` field uses `db.date()` (should be `db.datetime()`)
5. The type export is missing

Fix all these issues so the model correctly defines an Employee with:

| Field      | Type     | Required | Notes          |
| ---------- | -------- | -------- | -------------- |
| name       | string   | yes      |                |
| department | string   | yes      |                |
| salary     | integer  | yes      |                |
| hireDate   | datetime | yes      |                |
| isActive   | boolean  | no       | Optional field |

The model must also include automatic timestamp fields (`createdAt`, `updatedAt`).

## Requirements

- The file must have a **named export** `employee` (the value)
- The file must also export the **type**: `export type employee = typeof employee;`
- The model name must be `"Employee"`
- All field types must use correct SDK API methods

## Reference

Refer to the installed SDK package for model definition patterns.
