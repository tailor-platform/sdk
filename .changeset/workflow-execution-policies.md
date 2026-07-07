---
"@tailor-platform/sdk": minor
---

Add workflow job function execution policies. Declare them with `defineWorkflowExecutionPolicies` (or the single-key `defineWorkflowExecutionPolicy`), register them via `workflowExecutionPolicies` on `defineConfig`, and pass a matching key through the new `executionPolicyKey` option on `triggerJobFunction` / `job.trigger()` to apply the platform-side concurrency cap. Keys accept `:` and a trailing `*` wildcard.
