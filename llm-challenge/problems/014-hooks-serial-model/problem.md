# 014: Hooks and Serial Model

## Goal

Create a TailorDB model definition for an **Invoice** that uses serial fields and hooks.

## Instructions

Create the file `tailordb/invoice.ts` that defines an `Invoice` model with the following fields:

| Field         | Type    | Required | Notes                                              |
| ------------- | ------- | -------- | -------------------------------------------------- |
| invoiceNumber | string  | yes      | Serial field: start at 1, format `"INV-{:05d}"`    |
| sequenceId    | integer | yes      | Serial field: start at 1000, maxValue 99999        |
| customerEmail | string  | yes      |                                                    |
| amount        | float   | yes      |                                                    |
| status        | enum    | yes      | Allowed values: `draft`, `sent`, `paid`, `overdue` |

The model must also include automatic timestamp fields (`createdAt`, `updatedAt`).

Additionally, apply **type-level hooks** for the following fields:

- `customerEmail`: on create, convert the value to lowercase using `value.toLowerCase()` (if value is not null; return an empty string for null)
- `customerEmail`: on update, convert the value to lowercase using `value.toLowerCase()` (if value is not null; return an empty string for null)

## Requirements

- The file must have a **named export** `invoice` (the value)
- The file must also export the **type**: `export type invoice = typeof invoice;`
- Use `.serial()` method for serial fields
- Use `.hooks()` (type-level) for the customerEmail field

## Reference

Refer to the installed SDK package for model definition patterns.
