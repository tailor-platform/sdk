# 032: Model with Validation

## Goal

Create a TailorDB model definition with field validation rules.

## Instructions

Create the file `tailordb/employee.ts` that defines an `Employee` model with the following fields:

| Field      | Type    | Required | Notes                                                                               |
| ---------- | ------- | -------- | ----------------------------------------------------------------------------------- |
| name       | string  | yes      | Validate: length >= 2, message "Name must be at least 2 characters"                 |
| age        | integer | yes      | Validate: >= 18 message "Must be at least 18", <= 120 message "Must be at most 120" |
| email      | string  | yes      | No validation                                                                       |
| department | enum    | yes      | Allowed values: `engineering`, `sales`, `marketing`, `hr`                           |

The model must also include automatic timestamp fields (`createdAt`, `updatedAt`).

### Validation

Use the `.validate()` method on fields:

- Each validation rule is a tuple: `[validatorFunction, errorMessage]`
- The validator function receives `{ value }` and returns `true` if valid
- Multiple rules can be passed as separate arguments to `.validate()`

## Requirements

- The file must have a **named export** `employee` (the value)
- The file must also export the **type**: `export type employee = typeof employee;`

## Reference

Refer to the installed SDK package for model definition and validation patterns.
