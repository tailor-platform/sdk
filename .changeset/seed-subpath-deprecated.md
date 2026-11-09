---
"@tailor-platform/sdk": minor
---

The seed schema files `tailor generate` writes now import `defineSchema` (and `fillIdpUserPassword` for the IdP user) from `@tailor-platform/sdk-plugin-seed/schema` instead of `@tailor-platform/sdk/seed`. Install `@tailor-platform/sdk-plugin-seed`, which the `tailor seed` commands need as well, and run `tailor generate` again to rewrite the files. Schema files generated before keep working. `@tailor-platform/sdk/seed` is now `@deprecated` and is removed in v3: import `defineSchema`, `fillIdpUserPassword`, `ForeignKeyDefinition`, and `IndexDefinition` from `@tailor-platform/sdk-plugin-seed/schema` instead. `validateSeedData`, `fillSeedData`, and `hookSeedRows` have no replacement import; run `tailor seed validate`, `tailor seed fill`, or `tailor seed apply`.
