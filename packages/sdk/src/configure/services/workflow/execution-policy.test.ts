import { describe, expect, test } from "vitest";
import { defineWorkflowExecutionPolicies, defineWorkflowExecutionPolicy } from "./execution-policy";

describe("defineWorkflowExecutionPolicies", () => {
  test("derives name and key from the property name (camelCase → kebab-case)", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      premium: define({ concurrencyPolicy: { maxConcurrentExecutions: 5 } }),
      tenantApi: define({ concurrencyPolicy: { maxConcurrentExecutions: 3 } }),
      legacyPipelineJob: define(),
    }));

    expect(policies.premium.name).toBe("premium");
    expect(policies.premium.key).toBe("premium");
    expect(policies.premium.concurrencyPolicy).toEqual({ maxConcurrentExecutions: 5 });

    expect(policies.tenantApi.name).toBe("tenant-api");
    expect(policies.tenantApi.key).toBe("tenant-api");

    expect(policies.legacyPipelineJob.name).toBe("legacy-pipeline-job");
    expect(policies.legacyPipelineJob.key).toBe("legacy-pipeline-job");
    expect(policies.legacyPipelineJob.concurrencyPolicy).toBeUndefined();
  });

  test("splits acronym boundaries in the property name", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      tenantAPIJob: define(),
      httpAPI: define(),
      HTTPServer: define(),
      myXMLParser: define(),
    }));

    expect(policies.tenantAPIJob.name).toBe("tenant-api-job");
    expect(policies.tenantAPIJob.key).toBe("tenant-api-job");

    expect(policies.httpAPI.name).toBe("http-api");
    expect(policies.httpAPI.key).toBe("http-api");

    expect(policies.HTTPServer.name).toBe("http-server");
    expect(policies.HTTPServer.key).toBe("http-server");

    expect(policies.myXMLParser.name).toBe("my-xml-parser");
    expect(policies.myXMLParser.key).toBe("my-xml-parser");
  });

  test("explicit key overrides the property-name-derived key without affecting name", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      tenantApi: define({
        key: "tenant-api*",
        concurrencyPolicy: { maxConcurrentExecutions: 3 },
      }),
      legacyPipeline: define({ key: "legacy:pipeline" }),
    }));

    expect(policies.tenantApi.name).toBe("tenant-api");
    expect(policies.tenantApi.key).toBe("tenant-api*");

    expect(policies.legacyPipeline.name).toBe("legacy-pipeline");
    expect(policies.legacyPipeline.key).toBe("legacy:pipeline");
  });

  test("explicit name overrides property-name-derived name without affecting key", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      shorthand: define({ name: "custom-name" }),
    }));

    expect(policies.shorthand.name).toBe("custom-name");
    // key defaults to the property name (kebab-case), not the explicit name.
    expect(policies.shorthand.key).toBe("shorthand");
  });

  test("explicit name and key are both preserved when provided", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      any: define({ name: "per-tenant", key: "tenant-api*" }),
    }));

    expect(policies.any.name).toBe("per-tenant");
    expect(policies.any.key).toBe("tenant-api*");
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
