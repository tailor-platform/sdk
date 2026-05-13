---
"@tailor-platform/sdk": patch
---

Fix a type/runtime mismatch where calling `workflowJob.trigger()` without `await` returned a raw value at runtime even though the static type is `Promise<Awaited<Output>>`. The bundler now wraps `.trigger()` in an async IIFE (`(async () => tailor.workflow.triggerJobFunction("...", args))()`), so the returned value is always a `Promise` (including for `.then()` chains and `Promise.all([...])`), synchronous throws from the platform surface as Promise rejections, and the platform's synchronous suspend semantics are preserved (the call site runs to completion before subsequent statements).
