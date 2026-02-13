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

The model must also include automatic timestamp fields (`createdAt`, `updatedAt`).

## Requirements

- Import the `author` type from `./author` to use in the relation
- The file must have a **named export** `book` (the value)
- The file must also export the **type**: `export type book = typeof book;`

## Reference

Refer to the installed SDK package for model definition and relation patterns.
