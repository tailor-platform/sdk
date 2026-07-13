---
"@tailor-platform/sdk": major
"@tailor-platform/sdk-codemod": patch
---

Derive default TailorDB forward relation names from the relation field name by removing a trailing `ID`, `Id`, or `id`, instead of deriving them from the target table name.

The v2 migration review identifies non-self relations without `toward.as`. Add an explicit name to preserve the v1 GraphQL field name, or update consumers to use the new field-based name.
