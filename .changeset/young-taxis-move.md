---
"@tailor-platform/sdk": patch
---

Reject duplicate generated enum constant names instead of silently overwriting definitions. Duplicates with identical values, which previously generated successfully, now fail too. Rename conflicting tables or fields to give their enum constants unique names.
