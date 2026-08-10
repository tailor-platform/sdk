---
"@tailor-platform/sdk": minor
---

Renaming a TailorDB field no longer silently drops the field's data: `tailordb migration generate` now detects rename candidates and records a confirmed rename as a single breaking `field_renamed` change with a scaffolded data-copy script, instead of decomposing it into a removal plus an addition. Note: older SDK versions cannot read a `diff.json` that contains a `field_renamed` change and stop with a validation error.
