# Add a required + unique string field to a TailorDB model

## Goal

Define a `User` TailorDB model with a single field, `email`, that is required and unique.

## Domain Context

A directory service needs to look up users by their primary email address, which must therefore be unique across the table. The model should fail validation if two records share the same email.

## What to Build

Create `tailordb/user.ts` that exports a `user` model named `"User"` with one field:

| Field | Kind   | Options             |
| ----- | ------ | ------------------- |
| email | string | required and unique |

The model is referenced from the prewired `tailor.config.ts`, which globs `./tailordb/*.ts`.

## Requirements

- Use the TailorDB field builders from `@tailor-platform/sdk` (the `db` namespace).
- The `email` field must be required.
- The `email` field must be unique.
- Do not introduce extra fields, hooks, validators, or descriptions for this exercise.

## Reference

Refer to the installed SDK package for the available field builder API and how to mark a string field as unique. No external documentation is required for this task.
