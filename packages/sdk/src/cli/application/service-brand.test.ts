import { describe, expect, test } from "vitest";
import { ZodError } from "zod";
import { ExecutorSchema } from "@/parser/service/executor";
import { ResolverSchema } from "@/parser/service/resolver";
import { TailorDBTypeSchema } from "@/parser/service/tailordb";
import { WorkflowSchema, WorkflowJobSchema } from "@/parser/service/workflow";
import { brandValue, isSdkBranded } from "@/utils/brand";

type SafeParseSchema<T> = {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: ZodError };
};

/**
 * Simulates the brand-based error categorization pattern used by all service loaders.
 * - Branded value + invalid schema -> throws (user's SDK code has a bug)
 * - Non-branded value + invalid schema -> skipped (unrelated export)
 * - Branded value + valid schema -> returns parsed data
 * @param schema - Zod schema with safeParse method
 * @param schema.safeParse - Safely parses a value and returns a discriminated union result
 * @param value - The value to parse and categorize
 * @returns Parsed data or "skipped" if non-branded and invalid
 */
function simulateServiceLoad<T>(schema: SafeParseSchema<T>, value: unknown): T | "skipped" {
  const result = schema.safeParse(value);
  if (!result.success) {
    if (isSdkBranded(value)) {
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
      const branded = brandValue({ ...validType });
      const result = simulateServiceLoad(TailorDBTypeSchema, branded);
      expect(result).not.toBe("skipped");
      expect(result).toHaveProperty("name", "TestType");
    });

    test("branded value with invalid schema throws ZodError", () => {
      const invalidType = brandValue({ name: "Test", invalidField: true });
      expect(() => simulateServiceLoad(TailorDBTypeSchema, invalidType)).toThrow(ZodError);
    });

    test("non-branded value with invalid schema is skipped", () => {
      const randomExport = { foo: "bar" };
      expect(simulateServiceLoad(TailorDBTypeSchema, randomExport)).toBe("skipped");
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
      const branded = brandValue({ ...validResolver });
      const result = simulateServiceLoad(ResolverSchema, branded);
      expect(result).not.toBe("skipped");
      expect(result).toHaveProperty("name", "getUser");
    });

    test("branded value with invalid schema throws ZodError", () => {
      const invalidResolver = brandValue({ name: "getUser", missingOperation: true });
      expect(() => simulateServiceLoad(ResolverSchema, invalidResolver)).toThrow(ZodError);
    });

    test("non-branded value with invalid schema is skipped", () => {
      const randomExport = { someHelper: () => {} };
      expect(simulateServiceLoad(ResolverSchema, randomExport)).toBe("skipped");
    });
  });

  describe("ExecutorSchema", () => {
    const validExecutor = {
      name: "onUserCreated",
      trigger: {
        kind: "recordCreated",
        typeName: "User",
      },
      operation: {
        kind: "function",
        body: () => {},
      },
    };

    test("branded value with valid schema loads successfully", () => {
      const branded = brandValue({ ...validExecutor });
      const result = simulateServiceLoad(ExecutorSchema, branded);
      expect(result).not.toBe("skipped");
      expect(result).toHaveProperty("name", "onUserCreated");
    });

    test("branded value with invalid schema throws ZodError", () => {
      const invalidExecutor = brandValue({ name: "onUserCreated", trigger: "invalid" });
      expect(() => simulateServiceLoad(ExecutorSchema, invalidExecutor)).toThrow(ZodError);
    });

    test("non-branded value with invalid schema is skipped", () => {
      const randomExport = "some constant";
      expect(simulateServiceLoad(ExecutorSchema, randomExport)).toBe("skipped");
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
      const branded = brandValue({ ...validWorkflow });
      const result = simulateServiceLoad(WorkflowSchema, branded);
      expect(result).not.toBe("skipped");
      expect(result).toHaveProperty("name", "approvalFlow");
    });

    test("branded value with invalid schema throws ZodError", () => {
      const invalidWorkflow = brandValue({ name: "approvalFlow" });
      expect(() => simulateServiceLoad(WorkflowSchema, invalidWorkflow)).toThrow(ZodError);
    });

    test("non-branded value with invalid schema is skipped", () => {
      const randomExport = [1, 2, 3];
      expect(simulateServiceLoad(WorkflowSchema, randomExport)).toBe("skipped");
    });
  });

  describe("WorkflowJobSchema", () => {
    const validJob = {
      name: "processOrder",
      trigger: () => {},
      body: () => {},
    };

    test("branded value with valid schema loads successfully", () => {
      const branded = brandValue({ ...validJob });
      const result = simulateServiceLoad(WorkflowJobSchema, branded);
      expect(result).not.toBe("skipped");
      expect(result).toHaveProperty("name", "processOrder");
    });

    test("branded value with invalid schema throws ZodError", () => {
      const invalidJob = brandValue({ name: "processOrder", body: "not a function" });
      expect(() => simulateServiceLoad(WorkflowJobSchema, invalidJob)).toThrow(ZodError);
    });

    test("non-branded value with invalid schema is skipped", () => {
      const randomExport = { helperFn: () => {} };
      expect(simulateServiceLoad(WorkflowJobSchema, randomExport)).toBe("skipped");
    });
  });
});
