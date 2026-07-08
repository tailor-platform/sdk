import { describe, expect, test } from "vitest";
import {
  defineWorkflowExecutionPolicies,
  defineWorkflowExecutionPolicy,
} from "#/configure/services/workflow/execution-policy";
import { toPlatformExecutionPolicyKey } from "./workflow-execution-policy";

describe("toPlatformExecutionPolicyKey", () => {
  test("returns key unchanged for an exact-match policy", () => {
    const policy = defineWorkflowExecutionPolicy("premium");
    expect(toPlatformExecutionPolicyKey(policy)).toBe("premium");
  });

  test("appends a trailing `*` for a policy declared with enableSuffix", () => {
    const policy = defineWorkflowExecutionPolicy("tenant-api", { enableSuffix: true });
    expect(toPlatformExecutionPolicyKey(policy)).toBe("tenant-api*");
  });

  test("appends a trailing `*` when enableSuffix is combined with an explicit key", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      tenantApi: define({ name: "tenant-api", key: "tenant-api", enableSuffix: true }),
    }));
    expect(toPlatformExecutionPolicyKey(policies.tenantApi)).toBe("tenant-api*");
  });
});
