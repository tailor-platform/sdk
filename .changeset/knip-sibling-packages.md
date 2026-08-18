---
"@tailor-platform/eslint-plugin-sdk": patch
---

Drop the `@types/eslint` runtime dependency. ESLint 9.0 and later ship their own type declarations, so installing this plugin no longer pulls in a redundant types package.
