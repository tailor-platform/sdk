import { describe, expect, expectTypeOf, test } from "vitest";
import { defineWorkflowExecutionPolicies, defineWorkflowExecutionPolicy } from "./execution-policy";
import type { ExecutionPolicyKey } from "#/runtime/workflow";

describe("defineWorkflowExecutionPolicies", () => {
  test("uses the property name verbatim for both name and key", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      premium: define({ concurrencyPolicy: { maxConcurrentExecutions: 5 } }),
      "tenant-api": define(),
    }));

    expect(policies.premium.name).toBe("premium");
    expect(policies.premium.key).toBe("premium");
    expect(policies.premium.enableSuffix).toBe(false);
    expect(policies.premium.concurrencyPolicy).toEqual({ maxConcurrentExecutions: 5 });

    expect(policies["tenant-api"].name).toBe("tenant-api");
    expect(policies["tenant-api"].key).toBe("tenant-api");
    expect(policies["tenant-api"].concurrencyPolicy).toBeUndefined();
  });

  test("explicit name overrides the property-name-derived name and the key follows it", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      tenantApi: define({ name: "tenant-api" }),
    }));

    expect(policies.tenantApi.name).toBe("tenant-api");
    // key defaults to the resolved `name` (not the property name) when `key`
    // itself is omitted.
    expect(policies.tenantApi.key).toBe("tenant-api");
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
      perTenant: define({ name: "per-tenant", key: "tenant-api" }),
    }));

    expect(policies.perTenant.name).toBe("per-tenant");
    expect(policies.perTenant.key).toBe("tenant-api");
  });

  test("enableSuffix on a property-name-derived key gets a forKey() builder returning a branded key", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      "tenant-api": define({ enableSuffix: true }),
    }));

    expect(policies["tenant-api"].key).toBe("tenant-api");
    expect(policies["tenant-api"].enableSuffix).toBe(true);
    expect(policies["tenant-api"].forKey("acme")).toBe("tenant-api.acme");
    expectTypeOf(policies["tenant-api"].forKey).toEqualTypeOf<
      (suffix: string) => ExecutionPolicyKey
    >();
    // The raw prefix itself is not branded — can't be used directly as executionPolicyKey.
    expectTypeOf(policies["tenant-api"].key).not.toExtend<ExecutionPolicyKey>();
  });

  test("enableSuffix combines with an explicit key (not mutually exclusive)", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      // key deliberately differs from name to show it's used independently.
      tenantApi: define({ name: "tenant-api", key: "tenant_api", enableSuffix: true }),
    }));

    expect(policies.tenantApi.key).toBe("tenant_api");
    expect(policies.tenantApi.forKey("acme")).toBe("tenant_api.acme");
  });

  test("the second argument's separator overrides the default `.` for every policy in the group", () => {
    const policies = defineWorkflowExecutionPolicies(
      (define) => ({
        "tenant-api": define({ enableSuffix: true }),
        "billing-api": define({ enableSuffix: true }),
      }),
      { separator: ":" },
    );

    expect(policies["tenant-api"].forKey("acme")).toBe("tenant-api:acme");
    expect(policies["billing-api"].forKey("acme")).toBe("billing-api:acme");
  });

  test("an exact-match key (enableSuffix not set) is branded and usable directly as executionPolicyKey", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      premium: define({ concurrencyPolicy: { maxConcurrentExecutions: 5 } }),
    }));

    expect(policies.premium.enableSuffix).toBe(false);
    expectTypeOf(policies.premium.key).toExtend<ExecutionPolicyKey>();
  });

  test("without enableSuffix, a policy has no forKey() at the type or value level", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      premium: define({ key: "premium-users" }),
    }));

    expect((policies.premium as { forKey?: unknown }).forKey).toBeUndefined();
    expectTypeOf(policies.premium).not.toHaveProperty("forKey");
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
    expect(policy.enableSuffix).toBe(false);
    expect(policy.concurrencyPolicy).toBeUndefined();
  });

  test("uses explicit key when provided", () => {
    const policy = defineWorkflowExecutionPolicy("per-tenant", {
      key: "tenant-api",
      concurrencyPolicy: { maxConcurrentExecutions: 3 },
    });
    expect(policy.name).toBe("per-tenant");
    expect(policy.key).toBe("tenant-api");
    expect(policy.concurrencyPolicy).toEqual({ maxConcurrentExecutions: 3 });
  });

  test("enableSuffix gets a forKey() builder returning a branded key", () => {
    const policy = defineWorkflowExecutionPolicy("tenant-api", { enableSuffix: true });
    expect(policy.forKey("acme")).toBe("tenant-api.acme");
    expectTypeOf(policy.forKey).toEqualTypeOf<(suffix: string) => ExecutionPolicyKey>();
  });

  test("enableSuffix combines with an explicit key (not mutually exclusive)", () => {
    // key deliberately differs from name to show it's used independently.
    const policy = defineWorkflowExecutionPolicy("tenant-api", {
      key: "tenant_api",
      enableSuffix: true,
    });
    expect(policy.forKey("acme")).toBe("tenant_api.acme");
  });

  test("separator overrides the default `.` used by forKey", () => {
    const policy = defineWorkflowExecutionPolicy("tenant-api", {
      enableSuffix: true,
      separator: ":",
    });
    expect(policy.forKey("acme")).toBe("tenant-api:acme");
  });

  test("without enableSuffix, a policy has no forKey() at the type or value level", () => {
    const policy = defineWorkflowExecutionPolicy("per-tenant");
    expect((policy as { forKey?: unknown }).forKey).toBeUndefined();
    expectTypeOf(policy).not.toHaveProperty("forKey");
  });
});
