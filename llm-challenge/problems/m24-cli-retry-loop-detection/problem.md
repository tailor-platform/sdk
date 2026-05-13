# Resolve all sibling occurrences of an undefined field builder in one pass

## Goal

Make `tailordb/article.ts` typecheck. The file currently calls a TailorDB
field builder that does not exist on the `db` namespace, and the same mistake
appears in two places within the same file. Fix both occurrences in a single
edit so the file compiles after one `tsc --noEmit` round.

## Domain Context

When the same incorrect API call recurs in a file, fixing one site at a time
causes the typecheck loop to fail in a cascade — each `tsc` run uncovers the
next instance. Catching sibling occurrences at once (e.g. via grep or
multi-cursor) collapses N rounds of fix/run into a single round.

## What to Build

Replace every call to the non-existent builder with the correct TailorDB
field builder, keeping the field shape (required, single string) intact.

The model exports `article` named `"Article"` with two fields:

| Field   | Kind   | Options  |
| ------- | ------ | -------- |
| title   | string | required |
| summary | string | required |

## Requirements

- After the fix, `npx tsc --noEmit` must complete cleanly.
- Both fields must be `string` typed.
- Do not introduce new helpers, types, or rewrite the file structure beyond
  swapping the field builders.
- Do not edit `tailor.config.ts`.

## Reference

Refer to the installed SDK package for the available TailorDB field builders.
No external documentation is required for this task.
