---
"@tailor-platform/sdk": patch
"@tailor-platform/create-sdk": patch
---

Mark the content mapper as a beta feature: the `contentMapper` option of `kyselyTypePlugin`, `getDB` from `@tailor-platform/sdk/plugin/kysely-type/db`, the docs, and the `content-mapper` template README now say so. It depends on TypeScript 7.1, which is still in development, and the `contentMappers` option is not final, so its behavior may change in a future release.
