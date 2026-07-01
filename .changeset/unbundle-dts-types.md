---
"@tailor-platform/sdk": patch
---

Ship unbundled type declarations so each `.d.mts` mirrors the source layout with real identifier names, instead of hashed chunks with minified aliases. JavaScript output stays bundled and the public API is unchanged.
