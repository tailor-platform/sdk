# 001: Simple Model Definition

## Goal

Create a TailorDB model definition for a **Blog Post**.

## Instructions

Create the file `tailordb/post.ts` that defines a `Post` model with the following fields:

| Field     | Type    | Required | Notes                                                |
| --------- | ------- | -------- | ---------------------------------------------------- |
| title     | string  | yes      |                                                      |
| content   | string  | no       | Optional field                                       |
| published | boolean | yes      |                                                      |
| category  | enum    | yes      | Allowed values: `tech`, `lifestyle`, `news`, `other` |

The model must also include automatic timestamp fields (`createdAt`, `updatedAt`).

## Requirements

- The file must have a **named export** `post` (the value)
- The file must also export the **type**: `export type post = typeof post;`

## Reference

Refer to the installed SDK package for model definition patterns.
