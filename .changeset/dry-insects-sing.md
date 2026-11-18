---
"@tailor-platform/sdk": patch
---

Fix `createTailorDBHook` so a table-level `create` hook receives the same `input` as when deployed: the `id` only when the data has one, only the fields the data carries or a field hook or default fills, and the dates that field hooks and `"now"` defaults produce as `Date` objects rather than ISO strings. A table hook that computes values from its input, run in unit tests or through `tailor seed validate` and `tailor seed fill`, now gets the same result as when deployed.
