---
"@tailor-platform/sdk": patch
---

Fix a type/runtime mismatch where calling `workflowJob.trigger()` without `await` returned a raw value at runtime even though the static type is `Promise<Awaited<Output>>`. The bundler now wraps `.trigger()` in `Promise.resolve(...)`, so both `await childJob.trigger(args)` and `childJob.trigger(args)` (or `Promise.all([childJob.trigger(args)])`) produce values consistent with the declared type.
