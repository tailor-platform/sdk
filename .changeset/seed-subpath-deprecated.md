---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": minor
---

The seed schema files `tailor generate` writes now import `defineSchema` (and `fillIdpUserPassword` for the IdP user) from `@tailor-platform/sdk-plugin-seed/schema` instead of `@tailor-platform/sdk/seed`. Update `@tailor-platform/sdk-plugin-seed` to the release that adds the `./schema` entry (install it first if the project does not have it; the `tailor seed` commands need it as well), then run `tailor generate` again to rewrite the files. With an older plugin, `tailor seed validate` cannot load the regenerated files and `tsc` reports TS2307 for `@tailor-platform/sdk-plugin-seed/schema`. The `v3/seed-subpath-to-plugin` codemod entry tells `tailor upgrade` to re-run `tailor generate`. Schema files generated before keep working. `@tailor-platform/sdk/seed` is now `@deprecated` and is removed in v3: import `defineSchema`, `fillIdpUserPassword`, `ForeignKeyDefinition`, and `IndexDefinition` from `@tailor-platform/sdk-plugin-seed/schema` instead. `validateSeedData`, `fillSeedData`, and `hookSeedRows` have no replacement import; run `tailor seed validate`, `tailor seed fill`, or `tailor seed apply`.
