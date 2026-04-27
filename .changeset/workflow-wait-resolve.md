---
"@tailor-platform/sdk": minor
---

Add wait/resolve support for human-in-the-loop workflows via `defineWaitPoint()` and `defineWaitPoints()` with typed `.wait()` and `.resolve()` methods.

Tighten `createWorkflowJob` I/O types: both `Input` and `Output` must now be JsonValue-compatible (plain objects/arrays; no class instances or functions). `Output` previously accepted `Jsonifiable` with a `Jsonify<Output>` return transform on `.trigger()`, but the platform runtime rejects non-plain objects, so the old types did not match actual runtime behavior.

Reject top-level `null` in `createWorkflowJob` `Input` and in wait-point `Payload`: the platform normalizes top-level `null`/`undefined` args to `{}`, so declaring a top-level nullable type would cause the body/callback to receive `{}` at runtime, mismatching the declared type. Nested `null` inside objects or arrays is preserved by JSON serialization and remains allowed.
