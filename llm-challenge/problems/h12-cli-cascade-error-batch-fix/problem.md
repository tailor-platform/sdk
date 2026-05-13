# Fix the same archaic db.text() call across three sibling tailordb files in one pass

## Goal

Three TailorDB model files all call a non-existent field builder
(`db.text()`). Fix every occurrence so the project typechecks. The most
efficient solution greps the workspace, identifies all sites, and applies the
replacement in a single batch — fixing one file at a time forces multiple
typecheck/generate iterations because each subsequent run only surfaces the
next remaining instance.

## Domain Context

A bulk renaming of a SDK field builder happened upstream, but the project's
three core model files (`article.ts`, `note.ts`, `post.ts`) still call the old
name. The build cascades errors across files until **every** call site is
updated. Catching all sibling occurrences before editing collapses N rounds of
fix/typecheck into one.

## What to Build

Replace every call to `db.text()` with the correct TailorDB string field
builder across all three files. Preserve each file's existing model shape:

| File                  | Model     | Fields                          |
| --------------------- | --------- | ------------------------------- |
| `tailordb/article.ts` | `Article` | `title`, `summary`              |
| `tailordb/note.ts`    | `Note`    | `heading`, `body`               |
| `tailordb/post.ts`    | `Post`    | `subject`, `content`, `excerpt` |

## Requirements

- After the fix, `npx tsc --noEmit` must complete cleanly.
- All fields named in the table above must be `string` typed.
- Do not introduce new helpers, types, or rewrite the file structure beyond
  swapping the field builders.
- Do not edit `tailor.config.ts`.

## Reference

Refer to the installed SDK package for the available TailorDB field builders.
No external documentation is required for this task.
