---
"@tailor-platform/sdk": minor
---

Add workflow job function execution policies. Declare them with `defineWorkflowExecutionPolicies` (or the single-key `defineWorkflowExecutionPolicy`), register them via `workflow.executionPolicies` on `defineConfig`, and pass the policy's `key` (or, for wildcard policies declared with `enableSuffix: true`, the value returned by `forKey(suffix)`) through the new `executionPolicyKey` option on `triggerJobFunction` / `job.trigger()` to apply the platform-side concurrency cap. `executionPolicyKey` only accepts values produced by a declared policy.
