import { defineWorkflowExecutionPolicies } from "@tailor-platform/sdk";

export const executionPolicies = defineWorkflowExecutionPolicies((define) => ({
  /** Fixed cap shared across all "premium" workers. */
  premium: define({ concurrencyPolicy: { maxConcurrentExecutions: 5 } }),
  /**
   * Per-tenant wildcard cap. Runtime keys look like `tenant-api.<tenantId>`,
   * built via `.forKey(tenantId)`. Explicit `name` because `tenant-api` is
   * not a valid JS identifier; `enableSuffix` registers `tenant-api` as a
   * wildcard prefix.
   */
  tenantApi: define({
    name: "tenant-api",
    enableSuffix: true,
    concurrencyPolicy: { maxConcurrentExecutions: 3 },
  }),
}));
