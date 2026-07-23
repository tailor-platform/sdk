---
"@tailor-platform/sdk": minor
---

Classify type-level unique index changes as breaking in `tailordb migration generate`: adding a unique index (or adding `unique` to an existing index, or changing a unique index's field set) now prompts for confirmation and auto-generates a `migrate.ts` that resolves duplicate value combinations before the constraint is enforced. During deploy, the pre-migration phase withholds the new unique index (or keeps the previous definition) until the migration script has run.
