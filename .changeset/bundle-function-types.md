---
"@tailor-platform/sdk": patch
"@tailor-platform/create-sdk": patch
---

Bundle `@tailor-platform/function-types` as a dependency of `@tailor-platform/sdk`. Users no longer need to install `@tailor-platform/function-types` separately or add it to their `tsconfig.json` types array. The ambient types are automatically available when importing from `@tailor-platform/sdk`.
