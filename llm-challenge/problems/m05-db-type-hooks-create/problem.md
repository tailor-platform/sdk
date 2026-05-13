# Normalize slug to lowercase via a type-level create hook

## Goal

Define an `Account` TailorDB model whose `slug` string field is normalized to lowercase by a create hook attached at the type level.

## Domain Context

A tenant directory keys accounts by URL slug. To avoid duplicate-but-different-case slugs (`Acme` vs `acme`), the platform forces every newly created slug through `toLowerCase()` before the record is persisted.

## What to Build

The prewired `tailor.config.ts` globs `./tailordb/*.ts`. Complete `tailordb/account.ts` so that it exports an `account` model named `"Account"` with the field below and a type-level hook that lowercases the slug on create.

| Field | Kind   | Hook                                  |
| ----- | ------ | ------------------------------------- |
| slug  | string | create: returns `value.toLowerCase()` |

## Requirements

- Use `db.type(...).hooks(...)` to attach the hook (type-level), not a chained `.hooks(...)` on the field itself.
- The `create` hook must accept the field's argument object and return a lowercase version of the supplied value.
- Do not introduce extra fields, validators, or descriptions for this exercise.

## Reference

Refer to the installed SDK package for the hook handler signature and where `hooks` sits in the TailorDB chain. No external documentation is required for this task.
