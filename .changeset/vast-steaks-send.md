---
"@tailor-platform/sdk": minor
---

Preserve optional nested properties in Kysely select types to match results where omitted keys are absent. Code reading these properties must handle both `null` and `undefined`, for example with `bio != null` before accessing `bio.length`.

Generated Kysely types now use plain objects and arrays for nested fields whose only special property is optionality, preserving their select, insert, and update types.
