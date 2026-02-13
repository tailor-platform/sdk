# 013: Nested Object Model

## Goal

Create a TailorDB model definition for a **Company** that uses nested object fields.

## Instructions

Create the file `tailordb/company.ts` that defines a `Company` model with the following fields:

| Field    | Type   | Required | Notes                                   |
| -------- | ------ | -------- | --------------------------------------- |
| name     | string | yes      | Add description: `"Company legal name"` |
| address  | object | yes      | Nested object (see below)               |
| contacts | object | yes      | Array of nested objects (see below)     |
| industry | string | no       | Optional field                          |

### address (nested object):

| Field   | Type   | Required |
| ------- | ------ | -------- |
| street  | string | yes      |
| city    | string | yes      |
| state   | string | no       |
| zipCode | string | yes      |
| country | string | yes      |

### contacts (array of nested objects):

| Field | Type   | Required |
| ----- | ------ | -------- |
| name  | string | yes      |
| email | string | yes      |
| role  | string | no       |

The model must also include automatic timestamp fields (`createdAt`, `updatedAt`).

Add a description to the type: `"Company information with nested address and contacts"`

## Requirements

- The file must have a **named export** `company` (the value)
- The file must also export the **type**: `export type company = typeof company;`
- Use `db.object()` for nested objects
- Use `{ array: true }` option for the contacts field
- Use `.description()` method to add descriptions

## Reference

Refer to the installed SDK package for model definition patterns.
