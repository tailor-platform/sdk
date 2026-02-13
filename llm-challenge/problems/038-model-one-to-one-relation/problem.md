# 038: Model with One-to-One Relation

## Goal

Create a TailorDB model definition for a **Profile** that has a one-to-one relation to the provided **User** model, using `toward.as` and `backward` options.

## Instructions

A `User` model is already provided in `tailordb/user.ts`. Create the file `tailordb/profile.ts` that defines a `Profile` model with the following fields:

| Field     | Type   | Required | Notes                                                                                              |
| --------- | ------ | -------- | -------------------------------------------------------------------------------------------------- |
| userId    | uuid   | yes      | 1-1 relation to the User model with `toward.as` set to `"owner"` and `backward` set to `"profile"` |
| bio       | string | no       | Optional field                                                                                     |
| avatarUrl | string | no       | Optional field                                                                                     |

The model must also include automatic timestamp fields (`createdAt`, `updatedAt`).

## Requirements

- Import the `user` type from `./user` to use in the relation
- The `userId` field must use a `1-1` relation type with both `toward.as` and `backward` configured
- The file must have a **named export** `profile` (the value)
- The file must also export the **type**: `export type profile = typeof profile;`

## Reference

Refer to the installed SDK package for model definition and relation patterns, especially the `toward.as` and `backward` options.
