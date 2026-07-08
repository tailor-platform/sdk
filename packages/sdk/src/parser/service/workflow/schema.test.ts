import { describe, expect, test } from "vitest";
import {
  ExecutionPolicyKeySchema,
  ExecutionPolicyNameSchema,
  WorkflowJobFunctionExecutionPolicySchema,
} from "./schema";

describe("ExecutionPolicyNameSchema", () => {
  test.each([
    ["premium", true],
    ["per-tenant", true],
    ["a-b", true],
    // Too short (min 3 chars).
    ["ab", false],
    // Cannot start with '-'.
    ["-foo", false],
    // Cannot end with '-'.
    ["foo-", false],
    // Uppercase not allowed.
    ["Foo", false],
    // ':' not allowed in name.
    ["a:b", false],
    // '.' not allowed in name.
    ["a.b", false],
    // '*' not allowed in name.
    ["foo*", false],
  ])("%s → %s", (input, expected) => {
    expect(ExecutionPolicyNameSchema.safeParse(input).success).toBe(expected);
  });
});

describe("ExecutionPolicyKeySchema (Phase 3 grammar)", () => {
  test.each([
    ["premium", true],
    ["tenant-api", true],
    ["tenant_api", true],
    ["a1", true],
    ["tenant-api*", true],
    ["tenant.api*", true],
    ["tenant.api", true],
    ["foo:bar", true],
    ["foo:bar*", true],
    // Cannot start with '-'.
    ["-foo", false],
    // Cannot start with ':'.
    [":foo", false],
    // Cannot start with '*'.
    ["*foo", false],
    // Wildcard only allowed at end (single char).
    ["a**", false],
    // Uppercase not allowed.
    ["Foo", false],
    // Too short (min 2 chars).
    ["a", false],
  ])("%s → %s", (input, expected) => {
    expect(ExecutionPolicyKeySchema.safeParse(input).success).toBe(expected);
  });
});

describe("WorkflowJobFunctionExecutionPolicySchema", () => {
  test("accepts a valid policy with concurrency", () => {
    const result = WorkflowJobFunctionExecutionPolicySchema.safeParse({
      name: "per-tenant",
      key: "tenant-api*",
      concurrencyPolicy: { maxConcurrentExecutions: 3 },
    });
    expect(result.success).toBe(true);
  });

  test("accepts a valid policy without concurrency", () => {
    const result = WorkflowJobFunctionExecutionPolicySchema.safeParse({
      name: "premium",
      key: "premium",
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid name grammar", () => {
    const result = WorkflowJobFunctionExecutionPolicySchema.safeParse({
      name: "Bad-Name",
      key: "ok",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid key grammar", () => {
    const result = WorkflowJobFunctionExecutionPolicySchema.safeParse({
      name: "premium",
      key: "!bad",
    });
    expect(result.success).toBe(false);
  });
});
