---
"@tailor-platform/sdk": minor
---

Add typed fields to `resolverExecutedTrigger` and `env` support for all executor args

- Add `success`, `result`, `error` fields to `ResolverExecutedArgs` with tagged union type
- Add `env: TailorEnv` to all trigger Args types and operation args
