import { describe, expect, test } from "vitest";
import { ExecutorSchema, GqlOperationSchema, WorkflowOperationSchema } from "./schema";

describe("GqlOperationSchema", () => {
  test("converts query to string", () => {
    const documentNode = {
      kind: "Document",
      definitions: [],
      toString: () => "query { users { id } }",
    };

    const result = GqlOperationSchema.safeParse({
      kind: "graphql",
      query: documentNode,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.query).toBe("query { users { id } }");
    }
  });

  test("accepts string query directly", () => {
    const result = GqlOperationSchema.safeParse({
      kind: "graphql",
      query: "query { users { id } }",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.query).toBe("query { users { id } }");
    }
  });
});

describe("WorkflowOperationSchema", () => {
  test("extracts workflowName from workflow object", () => {
    const result = WorkflowOperationSchema.safeParse({
      kind: "workflow",
      workflow: { name: "my-workflow" },
      args: { id: "123" },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.workflowName).toBe("my-workflow");
      expect(result.data).not.toHaveProperty("workflow");
    }
  });

  test("accepts workflowName directly", () => {
    const result = WorkflowOperationSchema.safeParse({
      kind: "workflow",
      workflowName: "my-workflow",
      args: { id: "123" },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.workflowName).toBe("my-workflow");
    }
  });
});

describe("ExecutorSchema", () => {
  test("transforms workflow executor correctly", () => {
    const result = ExecutorSchema.safeParse({
      name: "test-executor",
      trigger: {
        kind: "schedule",
        cron: "0 12 * * *",
      },
      operation: {
        kind: "workflow",
        workflow: { name: "test-workflow" },
        args: { orderId: "test-id" },
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.operation.kind).toBe("workflow");
      if (result.data.operation.kind === "workflow") {
        expect(result.data.operation.workflowName).toBe("test-workflow");
      }
    }
  });

  test("transforms graphql executor correctly", () => {
    const documentNode = {
      kind: "Document",
      toString: () => "mutation { createUser { id } }",
    };

    const result = ExecutorSchema.safeParse({
      name: "test-executor",
      trigger: {
        kind: "schedule",
        cron: "0 12 * * *",
      },
      operation: {
        kind: "graphql",
        query: documentNode,
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.operation.kind).toBe("graphql");
      if (result.data.operation.kind === "graphql") {
        expect(result.data.operation.query).toBe("mutation { createUser { id } }");
      }
    }
  });
});
