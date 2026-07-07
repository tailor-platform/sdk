import { describe, expect, test } from "vitest";
import { defineWorkflowExecutionPolicies, defineWorkflowExecutionPolicy } from "./execution-policy";

describe("defineWorkflowExecutionPolicies", () => {
  test("uses the property name verbatim for both name and key", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      premium: define({ concurrencyPolicy: { maxConcurrentExecutions: 5 } }),
      "tenant-api": define(),
    }));

    expect(policies.premium.name).toBe("premium");
    expect(policies.premium.key).toBe("premium");
    expect(policies.premium.concurrencyPolicy).toEqual({ maxConcurrentExecutions: 5 });

    expect(policies["tenant-api"].name).toBe("tenant-api");
    expect(policies["tenant-api"].key).toBe("tenant-api");
    expect(policies["tenant-api"].concurrencyPolicy).toBeUndefined();
  });

  test("explicit name overrides the property-name-derived name without touching the key", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      tenantApi: define({ name: "tenant-api" }),
    }));

    expect(policies.tenantApi.name).toBe("tenant-api");
    // key still defaults to the property name; overriding `name` alone does not
    // rewrite the runtime lookup key.
    expect(policies.tenantApi.key).toBe("tenantApi");
  });

  test("explicit key overrides the property-name-derived key without touching the name", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      premium: define({
        key: "premium-users",
        concurrencyPolicy: { maxConcurrentExecutions: 3 },
      }),
    }));

    expect(policies.premium.name).toBe("premium");
    expect(policies.premium.key).toBe("premium-users");
  });

  test("explicit name and key are both preserved when provided", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      perTenant: define({ name: "per-tenant", key: "tenant-api*" }),
    }));

    expect(policies.perTenant.name).toBe("per-tenant");
    expect(policies.perTenant.key).toBe("tenant-api*");
  });

  test("returns instances that carry the SDK brand", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      premium: define(),
    }));
    // brandValue attaches a non-enumerable symbol; readable via Object.getOwnPropertySymbols.
    const brandSymbol = Object.getOwnPropertySymbols(policies.premium).find((s) =>
      s.toString().includes("tailor-platform/sdk"),
    );
    expect(brandSymbol).toBeDefined();
  });
});

describe("defineWorkflowExecutionPolicy", () => {
  test("uses name as key when key is omitted", () => {
    const policy = defineWorkflowExecutionPolicy("per-tenant");
    expect(policy.name).toBe("per-tenant");
    expect(policy.key).toBe("per-tenant");
    expect(policy.concurrencyPolicy).toBeUndefined();
  });

  test("uses explicit key when provided", () => {
    const policy = defineWorkflowExecutionPolicy("per-tenant", {
      key: "tenant-api*",
      concurrencyPolicy: { maxConcurrentExecutions: 3 },
    });
    expect(policy.name).toBe("per-tenant");
    expect(policy.key).toBe("tenant-api*");
    expect(policy.concurrencyPolicy).toEqual({ maxConcurrentExecutions: 3 });
  });
});
