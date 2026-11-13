---
"@tailor-platform/create-sdk": minor
---

Add the `content-mapper` template. TypeScript derives its types from `tailor.config.ts` through the SDK's content mapper instead of `tailor.d.ts`. It pins `typescript@7.1.0-beta`, since the content mapper needs TypeScript 7.1.
