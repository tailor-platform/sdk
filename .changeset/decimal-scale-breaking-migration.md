---
"@tailor-platform/sdk": minor
---

Classify decimal `scale` changes as breaking in `tailordb migration generate`: the change now prompts for confirmation and auto-generates a `migrate.ts` that re-saves existing rows so their stored values are re-serialized under the new scale. The generated script works around a platform-side re-serialization gap rather than transforming data, and can be removed once the platform-side fix is confirmed.
