import { describe, expect, test } from "vitest";
import { ZodError } from "zod";
import { ExecutorSchema } from "#/parser/service/executor/index";
import { ResolverSchema } from "#/parser/service/resolver/index";
import { TailorDBTypeSchema } from "#/parser/service/tailordb/index";
import { WorkflowSchema, WorkflowJobSchema } from "#/parser/service/workflow/index";
import { type SdkBrandKind, brandValue, isSdkBranded } from "#/utils/brand";

type SafeParseSchema<T> = {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: ZodError };
};

/**
 * Simulates the brand-based error categorization pattern used by all service loaders.
 * - Branded value with matching kind + invalid schema -> throws (user's SDK code has a bug)
 * - Branded value with different kind + invalid schema -> skipped (different SDK object)
 * - Non-branded value + invalid schema -> skipped (unrelated export)
 * - Branded value + valid schema -> returns parsed data
 * @param schema - Zod schema with safeParse method
 * @param schema.safeParse - Safely parses a value and returns a discriminated union result
 * @param value - The value to parse and categorize
 * @param kind - The expected brand kind for this service loader
 * @returns Parsed data or "skipped" if non-branded and invalid
 */
function simulateServiceLoad<T>(
  schema: SafeParseSchema<T>,
  value: unknown,
  kind: SdkBrandKind,
): T | "skipped" {
  const result = schema.safeParse(value);
  if (!result.success) {
    if (isSdkBranded(value, kind)) {
      throw result.error;
    }
    return "skipped";
  }
  return result.data;
}

/**
 * Registers the three tests shared by every service loader: a branded value
 * with a valid schema loads, a branded value with an invalid schema throws,
 * and a non-branded value with an invalid schema is skipped.
 * @param schema - Zod schema with safeParse method
 * @param schema.safeParse - Safely parses a value and returns a discriminated union result
 * @param kind - The expected brand kind for this service loader
 * @param validValue - A value that satisfies the schema once branded
 * @param invalidValue - A value that fails the schema once branded
 * @param validName - Expected `name` property on the successfully parsed value
 * @param randomExport - An unrelated, non-branded value that also fails the schema
 */
function itLoadsBrandedValues<T>(
  schema: SafeParseSchema<T>,
  kind: SdkBrandKind,
  validValue: Record<string, unknown>,
  invalidValue: Record<string, unknown>,
  validName: string,
  randomExport: unknown,
) {
  test("branded value with valid schema loads successfully", () => {
    const branded = brandValue({ ...validValue }, kind);
    const result = simulateServiceLoad(schema, branded, kind);
    expect(result).not.toBe("skipped");
    expect(result).toHaveProperty("name", validName);
  });

  test("branded value with invalid schema throws ZodError", () => {
    const invalid = brandValue(invalidValue, kind);
    expect(() => simulateServiceLoad(schema, invalid, kind)).toThrow(ZodError);
  });

  test("non-branded value with invalid schema is skipped", () => {
    expect(simulateServiceLoad(schema, randomExport, kind)).toBe("skipped");
  });
}

describe("service brand-based error categorization", () => {
  describe("TailorDBTypeSchema", () => {
    itLoadsBrandedValues(
      TailorDBTypeSchema,
      "tailordb-type",
      {
        name: "TestType",
        fields: { title: { type: "string", metadata: {} } },
        metadata: { name: "TestType", permissions: {}, files: {} },
      },
      { name: "Test", invalidField: true },
      "TestType",
      { foo: "bar" },
    );

    test("executor-branded value is skipped by type loader", () => {
      const executor = brandValue(
        {
          name: "onUserCreated",
          trigger: { kind: "tailordb", events: ["tailordb.type_record.created"] },
        },
        "executor",
      );
      expect(simulateServiceLoad(TailorDBTypeSchema, executor, "tailordb-type")).toBe("skipped");
    });

    test("resolver-branded value is skipped by type loader", () => {
      const resolver = brandValue(
        { name: "getUser", operation: "query", body: () => {} },
        "resolver",
      );
      expect(simulateServiceLoad(TailorDBTypeSchema, resolver, "tailordb-type")).toBe("skipped");
    });
  });

  describe("ResolverSchema", () => {
    itLoadsBrandedValues(
      ResolverSchema,
      "resolver",
      {
        operation: "query",
        name: "getUser",
        body: () => {},
        output: { type: "string", fields: {}, metadata: {} },
      },
      { name: "getUser", missingOperation: true },
      "getUser",
      { someHelper: () => {} },
    );
  });

  describe("ExecutorSchema", () => {
    itLoadsBrandedValues(
      ExecutorSchema,
      "executor",
      {
        name: "onUserCreated",
        trigger: {
          kind: "tailordb",
          events: ["tailordb.type_record.created"],
          typeName: "User",
        },
        operation: { kind: "function", body: () => {} },
      },
      { name: "onUserCreated", trigger: "invalid" },
      "onUserCreated",
      "some constant",
    );
  });

  describe("WorkflowSchema", () => {
    itLoadsBrandedValues(
      WorkflowSchema,
      "workflow",
      {
        name: "approvalFlow",
        mainJob: { name: "startApproval", trigger: () => {}, body: () => {} },
      },
      { name: "approvalFlow" },
      "approvalFlow",
      [1, 2, 3],
    );
  });

  describe("WorkflowJobSchema", () => {
    itLoadsBrandedValues(
      WorkflowJobSchema,
      "workflow-job",
      { name: "processOrder", trigger: () => {}, body: () => {} },
      { name: "processOrder", body: "not a function" },
      "processOrder",
      { helperFn: () => {} },
    );
  });
});
