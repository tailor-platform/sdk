---
"@tailor-platform/sdk": minor
---

Renaming a TailorDB type no longer silently drops its records: `tailordb migration generate` now detects type rename candidates and records a confirmed rename as a single breaking `type_renamed` change with a scaffolded id-preserving data-copy script, instead of decomposing it into a removal plus an addition (confirm interactively, or via `--rename "OldType:NewType"` / `--drop "Type"` in non-interactive runs). Note: older SDK versions cannot read a `diff.json` that contains a `type_renamed` change and stop with a validation error.
