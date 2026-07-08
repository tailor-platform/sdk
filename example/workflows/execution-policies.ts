import { defineWorkflowExecutionPolicies } from "@tailor-platform/sdk";

export const executionPolicies = defineWorkflowExecutionPolicies((define) => ({
  /** Fixed cap shared across all "premium" workers. */
  premium: define({ concurrencyPolicy: { maxConcurrentExecutions: 5 } }),
  /**
   * Per-tenant wildcard cap. Runtime keys look like `tenant-api.<tenantId>`,
   * built via `.keyFor(tenantId)`. Explicit `name` because `tenant-api` is
   * not a valid JS identifier; `matchType: "prefix"` registers `tenant-api`
   * as a wildcard prefix.
   */
  tenantApi: define({
    name: "tenant-api",
    matchType: "prefix",
    concurrencyPolicy: { maxConcurrentExecutions: 3 },
  }),
}));
