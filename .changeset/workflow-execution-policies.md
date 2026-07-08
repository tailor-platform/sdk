---
"@tailor-platform/sdk": minor
---

Add workflow job function execution policies. Declare them with `defineWorkflowExecutionPolicies` (or the single-key `defineWorkflowExecutionPolicy`), register them via `workflow.executionPolicies` on `defineConfig`, and pass the policy's `key` (or, for wildcard policies declared with `enableSuffix: true`, the value returned by `keyFor(suffix)`) through the new `executionPolicyKey` option on `triggerJobFunction` / `job.trigger()` to apply the platform-side concurrency cap. `executionPolicyKey` only accepts values produced by a declared policy. `keyFor` joins the prefix and suffix with `.` by default; override it with `separator`, passed as the second argument to `defineWorkflowExecutionPolicies` (applies to every policy in the group) or as a `def` field on a single `defineWorkflowExecutionPolicy`.
