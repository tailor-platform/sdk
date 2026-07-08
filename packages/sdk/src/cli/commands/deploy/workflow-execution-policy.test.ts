import { describe, expect, test } from "vitest";
import {
  defineWorkflowExecutionPolicies,
  defineWorkflowExecutionPolicy,
} from "#/configure/services/workflow/execution-policy";
import {
  planWorkflowJobFunctionExecutionPolicy,
  toPlatformExecutionPolicyKey,
} from "./workflow-execution-policy";

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
      // key deliberately differs from name to show it's used independently.
      tenantApi: define({ name: "tenant-api", key: "tenant_api", enableSuffix: true }),
    }));
    expect(toPlatformExecutionPolicyKey(policies.tenantApi)).toBe("tenant_api*");
  });
});

describe("planWorkflowJobFunctionExecutionPolicy", () => {
  test("rejects a declared key that already ends with '*', regardless of enableSuffix", async () => {
    const policy = defineWorkflowExecutionPolicy("tenant-api", { key: "tenant-api*" });
    await expect(
      // Validation runs before the client is touched, so an empty stub suffices.
      planWorkflowJobFunctionExecutionPolicy({} as never, "ws-id", "app", undefined, {
        tenantApi: policy,
      }),
    ).rejects.toThrow(/key must not end with '\*'/);
  });

  test("rejects a hand-constructed wildcard policy missing the internal key", async () => {
    // ExecutionPolicyWildcardInstance's public type has no `key`, so nothing
    // stops a caller from hand-constructing one that skips the builder and
    // genuinely lacks the internal prefix.
    const policy = { name: "tenant-api", enableSuffix: true, keyFor: () => "" } as never;
    await expect(
      planWorkflowJobFunctionExecutionPolicy({} as never, "ws-id", "app", undefined, {
        tenantApi: policy,
      }),
    ).rejects.toThrow(/must be created via defineWorkflowExecutionPolicy/);
  });
});
