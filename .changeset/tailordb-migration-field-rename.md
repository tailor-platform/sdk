---
"@tailor-platform/sdk": minor
---

Add first-class field rename support to TailorDB migrations. `tailordb migration generate` now detects removed + added field pairs with a compatible shape and asks whether the change is a rename. Non-interactive runs (`--yes` or no TTY) fail while a rename candidate is unresolved; resolve each candidate with `--rename "Type.oldField:newField"` or confirm the removal with `--drop "Type.field"`. A confirmed rename is recorded as a single breaking `field_renamed` change: a `migrate.ts` that copies the old field's values into the new field is scaffolded, `db.ts` exposes both the old (readable) and new (writable) fields, and deploy keeps both fields alive until the copy finishes before dropping the old one. Note: older SDK versions cannot read a `diff.json` that contains a `field_renamed` change and stop with a validation error.
