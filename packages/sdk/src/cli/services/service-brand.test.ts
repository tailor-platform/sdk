import { describe, expect, test } from "vitest";
import { ZodError } from "zod";
import { ExecutorSchema } from "@/parser/service/executor";
import { ResolverSchema } from "@/parser/service/resolver";
import { TailorDBTypeSchema } from "@/parser/service/tailordb";
import { WorkflowSchema, WorkflowJobSchema } from "@/parser/service/workflow";
import { type SdkBrandKind, brandValue, isSdkBranded } from "@/utils/brand";

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

describe("service brand-based error categorization", () => {
  describe("TailorDBTypeSchema", () => {
    const validType = {
      name: "TestType",
      fields: {
        title: {
          type: "string",
          metadata: {},
        },
      },
      metadata: {
        name: "TestType",
        permissions: {},
        files: {},
      },
    };

    test("branded value with valid schema loads successfully", () => {
      const branded = brandValue({ ...validType }, "tailordb-type");
      const result = simulateServiceLoad(TailorDBTypeSchema, branded, "tailordb-type");
      expect(result).not.toBe("skipped");
      expect(result).toHaveProperty("name", "TestType");
    });

    test("branded value with invalid schema throws ZodError", () => {
      const invalidType = brandValue({ name: "Test", invalidField: true }, "tailordb-type");
      expect(() => simulateServiceLoad(TailorDBTypeSchema, invalidType, "tailordb-type")).toThrow(
        ZodError,
      );
    });

    test("non-branded value with invalid schema is skipped", () => {
      const randomExport = { foo: "bar" };
      expect(simulateServiceLoad(TailorDBTypeSchema, randomExport, "tailordb-type")).toBe(
        "skipped",
      );
    });

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
    const validResolver = {
      operation: "query",
      name: "getUser",
      body: () => {},
      output: {
        type: "string",
        fields: {},
        metadata: {},
      },
    };

    test("branded value with valid schema loads successfully", () => {
      const branded = brandValue({ ...validResolver }, "resolver");
      const result = simulateServiceLoad(ResolverSchema, branded, "resolver");
      expect(result).not.toBe("skipped");
      expect(result).toHaveProperty("name", "getUser");
    });

    test("branded value with invalid schema throws ZodError", () => {
      const invalidResolver = brandValue({ name: "getUser", missingOperation: true }, "resolver");
      expect(() => simulateServiceLoad(ResolverSchema, invalidResolver, "resolver")).toThrow(
        ZodError,
      );
    });

    test("non-branded value with invalid schema is skipped", () => {
      const randomExport = { someHelper: () => {} };
      expect(simulateServiceLoad(ResolverSchema, randomExport, "resolver")).toBe("skipped");
    });
  });

  describe("ExecutorSchema", () => {
    const validExecutor = {
      name: "onUserCreated",
      trigger: {
        kind: "tailordb",
        events: ["tailordb.type_record.created"],
        typeName: "User",
      },
      operation: {
        kind: "function",
        body: () => {},
      },
    };

    test("branded value with valid schema loads successfully", () => {
      const branded = brandValue({ ...validExecutor }, "executor");
      const result = simulateServiceLoad(ExecutorSchema, branded, "executor");
      expect(result).not.toBe("skipped");
      expect(result).toHaveProperty("name", "onUserCreated");
    });

    test("branded value with invalid schema throws ZodError", () => {
      const invalidExecutor = brandValue({ name: "onUserCreated", trigger: "invalid" }, "executor");
      expect(() => simulateServiceLoad(ExecutorSchema, invalidExecutor, "executor")).toThrow(
        ZodError,
      );
    });

    test("non-branded value with invalid schema is skipped", () => {
      const randomExport = "some constant";
      expect(simulateServiceLoad(ExecutorSchema, randomExport, "executor")).toBe("skipped");
    });
  });

  describe("WorkflowSchema", () => {
    const validWorkflow = {
      name: "approvalFlow",
      mainJob: {
        name: "startApproval",
        trigger: () => {},
        body: () => {},
      },
    };

    test("branded value with valid schema loads successfully", () => {
      const branded = brandValue({ ...validWorkflow }, "workflow");
      const result = simulateServiceLoad(WorkflowSchema, branded, "workflow");
      expect(result).not.toBe("skipped");
      expect(result).toHaveProperty("name", "approvalFlow");
    });

    test("branded value with invalid schema throws ZodError", () => {
      const invalidWorkflow = brandValue({ name: "approvalFlow" }, "workflow");
      expect(() => simulateServiceLoad(WorkflowSchema, invalidWorkflow, "workflow")).toThrow(
        ZodError,
      );
    });

    test("non-branded value with invalid schema is skipped", () => {
      const randomExport = [1, 2, 3];
      expect(simulateServiceLoad(WorkflowSchema, randomExport, "workflow")).toBe("skipped");
    });
  });

  describe("WorkflowJobSchema", () => {
    const validJob = {
      name: "processOrder",
      trigger: () => {},
      body: () => {},
    };

    test("branded value with valid schema loads successfully", () => {
      const branded = brandValue({ ...validJob }, "workflow-job");
      const result = simulateServiceLoad(WorkflowJobSchema, branded, "workflow-job");
      expect(result).not.toBe("skipped");
      expect(result).toHaveProperty("name", "processOrder");
    });

    test("branded value with invalid schema throws ZodError", () => {
      const invalidJob = brandValue(
        { name: "processOrder", body: "not a function" },
        "workflow-job",
      );
      expect(() => simulateServiceLoad(WorkflowJobSchema, invalidJob, "workflow-job")).toThrow(
        ZodError,
      );
    });

    test("non-branded value with invalid schema is skipped", () => {
      const randomExport = { helperFn: () => {} };
      expect(simulateServiceLoad(WorkflowJobSchema, randomExport, "workflow-job")).toBe("skipped");
    });
  });
});
