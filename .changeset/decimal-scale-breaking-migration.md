---
"@tailor-platform/sdk": patch
---

Classify decimal `scale` changes as breaking in `tailordb migration generate`: the change now prompts for confirmation and auto-generates a `migrate.ts` that re-saves existing rows so their stored values are re-serialized under the new scale. Decreasing scale rounds values half-up and can lose precision. The generated script also avoids overwriting concurrent changes to the same field and checks newly unique values after re-serialization.
