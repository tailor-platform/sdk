import { defineWorkflowExecutionPolicies } from "@tailor-platform/sdk";

export const executionPolicies = defineWorkflowExecutionPolicies((define) => ({
  /** Fixed cap shared across all "premium" workers. */
  premium: define({ concurrencyPolicy: { maxConcurrentExecutions: 5 } }),
  /**
   * Per-tenant wildcard cap. Runtime keys look like `tenant-api.<tenantId>`.
   * Explicit `name` because `tenant-api` is not a valid JS identifier, and
   * explicit `key` because it carries the trailing `*` wildcard.
   */
  tenantApi: define({
    name: "tenant-api",
    key: "tenant-api*",
    concurrencyPolicy: { maxConcurrentExecutions: 3 },
  }),
}));
