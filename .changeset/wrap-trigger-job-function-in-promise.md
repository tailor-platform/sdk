---
"@tailor-platform/sdk": patch
---

Fix a type/runtime mismatch where calling `workflowJob.trigger()` without `await` returned a raw value at runtime even though the static type is `Promise<Awaited<Output>>`. The bundler now defers `.trigger()` through `Promise.resolve().then(...)`, so the returned value is always a `Promise` (including for `.then()` chains and `Promise.all([...])`) and synchronous throws from the platform surface as Promise rejections.
