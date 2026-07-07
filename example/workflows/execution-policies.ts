import { defineWorkflowExecutionPolicies } from "@tailor-platform/sdk";

export const executionPolicies = defineWorkflowExecutionPolicies((define) => ({
  /** Fixed cap shared across all "premium" workers. */
  premium: define({ concurrencyPolicy: { maxConcurrentExecutions: 5 } }),
  /** Per-tenant wildcard cap. Runtime keys look like `tenant-api.<tenantId>`. */
  tenantApi: define({
    key: "tenant-api*",
    concurrencyPolicy: { maxConcurrentExecutions: 3 },
  }),
}));
