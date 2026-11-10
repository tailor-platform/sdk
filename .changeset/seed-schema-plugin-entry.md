---
"@tailor-platform/sdk-plugin-seed": minor
---

Add the `@tailor-platform/sdk-plugin-seed/schema` entry, which exports `defineSchema`, `fillIdpUserPassword`, and the `ForeignKeyDefinition` and `IndexDefinition` types. The seed schema files `tailor generate` writes now import from it, so update this package together with `@tailor-platform/sdk`.
