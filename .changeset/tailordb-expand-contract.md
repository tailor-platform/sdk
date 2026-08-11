---
"@tailor-platform/sdk": minor
---

Convert a TailorDB field to a type that cannot be applied in place without writing the migrations by hand. `tailor tailordb migration generate` now offers to carry the values through a temporary field and writes both migrations for you; you supply the conversion expression. Non-interactive runs opt in per field with `--expand-contract "Type.field"`, and still fail without it.

Writes that land on the field while the conversion runs are dropped rather than converted, so stop writing to it first on a live workspace. Array-cardinality changes, unique fields, and fields named by an index, relationship, permission, or type-level script remain manual.
