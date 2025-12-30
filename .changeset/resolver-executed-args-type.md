---
"@tailor-platform/sdk": minor
---

Add typed `success`, `result`, and `error` fields to `resolverExecutedTrigger` args

- Add tagged union type to `ResolverExecutedArgs` with `success: true | false` discriminator
- When `success` is `true`, `result` contains the resolver output (`output<R["output"]>`)
- When `success` is `false`, `error` contains the error message (`string`)
- Transform server's `succeeded`/`failed` fields to `success`/`result`/`error` at runtime
- Extract `result` from `args.succeeded.result.resolver` to match the resolver output type
