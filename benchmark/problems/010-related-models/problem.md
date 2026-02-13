# 010: Related Models

## Goal

Create a TailorDB model definition for a **Book** that has a relation to the provided **Author** model.

## Instructions

An `Author` model is already provided in `tailordb/author.ts`. Create the file `tailordb/book.ts` that defines a `Book` model with the following fields:

| Field    | Type    | Required | Notes                            |
| -------- | ------- | -------- | -------------------------------- |
| title    | string  | yes      |                                  |
| isbn     | string  | yes      | Must be unique                   |
| price    | integer | no       | Optional field                   |
| authorID | uuid    | yes      | n-1 relation to the Author model |

The model must also include automatic timestamp fields (`createdAt`, `updatedAt`) using `db.fields.timestamps()`.

## Requirements

- Use `db.type()` to define the model
- Use `db.string()`, `db.int()`, `db.uuid()`, and `db.fields.timestamps()`
- Use `.unique()` on the `isbn` field
- Use `.relation({ type: "n-1", toward: { type: author } })` on the `authorID` field
- Import the `author` type from `./author`
- The file must have a **named export** `book` (the value)
- The file must also export the **type**: `export type book = typeof book;`

## Example

Refer to the SDK documentation for model definition patterns using `db.type()` and `.relation()`.
