---
"@tailor-platform/sdk": major
"@tailor-platform/sdk-codemod": patch
---

Rename the `defineIdp` option `publishUserEvents` to `publishEvents`, so all four services that publish events use one field name. A codemod rewrites the option key on `defineIdp` calls, including aliased and namespace imports, and rewrites a shorthand `{ publishUserEvents }` to `{ publishEvents: publishUserEvents }` so it keeps reading the same local. Occurrences it cannot rewrite — an options object built outside the call, a computed key, or a type declaration of the option — are reported for manual migration.
