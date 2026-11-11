---
"@tailor-platform/sdk": major
---

Preserve optional nested properties in Kysely select types to match results where omitted keys are absent. Code reading these properties must handle both `null` and `undefined`, for example with `bio != null` before accessing `bio.length`.
