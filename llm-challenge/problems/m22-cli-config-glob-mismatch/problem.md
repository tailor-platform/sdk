# Recover tailor-sdk generate from a misconfigured file glob

## Goal

Fix `tailor.config.ts` so that `pnpm tailor-sdk generate` discovers the
`Order` TailorDB model and produces output successfully. The repository ships
with the model in place, but the config glob points at the wrong file
extension, so the CLI fails before reading the file.

## Domain Context

The Tailor SDK CLI walks each service's `files` glob (relative to
`tailor.config.ts`) and parses every match. When the glob fails to match any
files, the CLI raises a configuration-time error rather than silently
producing an empty namespace. The wrong extension here makes the SDK believe
the namespace has no types, which masks the real intent of the repo.

## What to Build

Adjust `tailor.config.ts` so that `db.tailordb.files` resolves to the
existing model file(s) in `tailordb/`. Do not move or rename the model file,
introduce additional files, or change `Order`'s field definitions.

## Requirements

- The fix must be confined to the `db.tailordb.files` glob in
  `tailor.config.ts`.
- After the fix, `pnpm tailor-sdk generate` must exit 0 and the CLI must
  discover the `Order` type.
- Do not edit `tailordb/order.ts`.
- Keep the config's `name`, default export shape, and existing comments
  intact apart from the glob change.

## Reference

Refer to the installed SDK package and `tailordb/order.ts` to confirm the
expected glob pattern. No external documentation is required for this task.
