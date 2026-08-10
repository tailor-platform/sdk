---
"@tailor-platform/sdk": minor
---

Renaming a TailorDB type no longer silently drops its records: `tailordb migration generate` now detects type rename candidates and records a confirmed rename as a single breaking `type_renamed` change (confirmed interactively or via `--rename "OldType:NewType"`, with `--drop "Type"` confirming a genuine removal). The scaffolded migration script copies every row into the new type preserving ids, and deploy creates the new type before the script runs and drops the old type only after the migration checkpoint advances. Note: older SDK versions cannot read a `diff.json` that contains a `type_renamed` change and stop with a validation error.
