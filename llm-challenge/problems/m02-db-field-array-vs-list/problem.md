# Write an optional string array field

## Goal

Define a `Post` TailorDB model with a single field, `tags`, that holds an optional array of strings.

## Domain Context

Blog posts carry zero or more free-form tags. The field must accept an array of strings; the field itself is optional (the post need not declare any tags at all).

## What to Build

Create `tailordb/post.ts` that exports a `post` model named `"Post"` with one field:

| Field | Kind   | Options         |
| ----- | ------ | --------------- |
| tags  | string | array, optional |

The model is referenced from the prewired `tailor.config.ts`, which globs `./tailordb/*.ts`.

## Requirements

- Use the TailorDB field builders from `@tailor-platform/sdk` (the `db` namespace).
- The `tags` field must be a string field declared as an array.
- The `tags` field must be optional.
- Do not introduce extra fields, hooks, validators, or descriptions for this exercise.

## Reference

Refer to the installed SDK package for the available field builder API and how to express both array-valued and optional fields. No external documentation is required for this task.
