---
"@tailor-platform/sdk": minor
---

Convert a single-value field into an array with `tailordb migration generate --expand-contract`. When only the array-ness changes, the generated migration pair stores each existing value as a one-element array and needs no edits; array-to-single-value changes remain manual.
