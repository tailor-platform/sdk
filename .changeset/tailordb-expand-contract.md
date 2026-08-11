---
"@tailor-platform/sdk": minor
---

Convert a TailorDB field to a type that cannot be applied in place without writing the migrations by hand. `tailor tailordb migration generate` now offers to carry the values through a temporary field and writes both migrations for you; only the conversion expression in the first one needs editing. Non-interactive runs opt in per field with `--expand-contract "Type.field"`, and still fail without it. Array-cardinality changes, unique fields, and fields named by an index, relationship, permission, or type-level script remain manual.
