import { describe, expect, expectTypeOf, test } from "vitest";
import {
  ExecutorSchema,
  FunctionOperationSchema,
  GqlOperationSchema,
  WorkflowOperationSchema,
} from "./schema";
import type { Executor, WorkflowOperationArgs } from "#/types/executor.generated";

function expectParseSuccess<T>(
  result: { success: true; data: T } | { success: false; error: unknown },
): T {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error("Expected schema parsing to succeed");
  }
  return result.data;
}

function expectParseFailure<T>(
  result: { success: true; data: T } | { success: false; error: { issues: unknown[] } },
): { issues: unknown[] } {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected schema parsing to fail");
  }
  return result.error;
}

function expectUnknownKeyRejected<T>(
  result: { success: true; data: T } | { success: false; error: { issues: unknown[] } },
) {
  const error = expectParseFailure(result);
  expect(error.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "unrecognized_keys",
      }),
    ]),
  );
}

describe("FunctionOperationSchema", () => {
  test("rejects unknown options", () => {
    expect.hasAssertions();

    expectUnknownKeyRejected(
      FunctionOperationSchema.safeParse({
        kind: "function",
        body: () => {},
        unknownOption: true,
      }),
    );
  });
});

describe("GqlOperationSchema", () => {
  const documentNode = {
    kind: "Document",
    definitions: [],
    toString: () => "query { users { id } }",
  };

  test.each([
    ["converts query to string", documentNode],
    ["accepts string query directly", "query { users { id } }"],
  ] as const)("%s", (_description, query) => {
    const result = GqlOperationSchema.safeParse({ kind: "graphql", query });
    const data = expectParseSuccess(result);
    expect(data.query).toBe("query { users { id } }");
  });

  test("rejects unknown options", () => {
    expect.hasAssertions();

    expectUnknownKeyRejected(
      GqlOperationSchema.safeParse({
        kind: "graphql",
        query: "query { users { id } }",
        unknownOption: true,
      }),
    );
  });
});

describe("WorkflowOperationSchema", () => {
  test("extracts workflowName from workflow object", () => {
    const result = WorkflowOperationSchema.safeParse({
      kind: "workflow",
      workflow: { name: "my-workflow" },
      args: { id: "123" },
    });

    const data = expectParseSuccess(result);
    expect(data.workflowName).toBe("my-workflow");
    expect(data).not.toHaveProperty("workflow");
  });

  test("accepts workflowName directly", () => {
    const result = WorkflowOperationSchema.safeParse({
      kind: "workflow",
      workflowName: "my-workflow",
      args: { id: "123" },
    });

    const data = expectParseSuccess(result);
    expect(data.workflowName).toBe("my-workflow");
  });

  test("rejects unknown options", () => {
    expect.hasAssertions();

    expectUnknownKeyRejected(
      WorkflowOperationSchema.safeParse({
        kind: "workflow",
        workflowName: "my-workflow",
        unknownOption: true,
      }),
    );
  });

  test.each([
    ["string", "hello"],
    ["empty string", ""],
    ["number", 42],
    ["zero", 0],
    ["boolean", true],
    ["false", false],
    ["array", ["hello", 42, false, null]],
  ])("accepts %s static args", (_description, args) => {
    const result = WorkflowOperationSchema.safeParse({
      kind: "workflow",
      workflowName: "my-workflow",
      args,
    });

    const data = expectParseSuccess(result);
    expect(data.args).toEqual(args);
  });

  test.each([
    ["top-level null", null],
    ["Date", new Date("2026-01-01T00:00:00.000Z")],
    ["Map", new Map([["key", "value"]])],
    ["nested Date", { nested: new Date("2026-01-01T00:00:00.000Z") }],
    ["nested Map", [new Map([["key", "value"]])]],
  ])("rejects unsupported %s static args", (_description, args) => {
    const result = WorkflowOperationSchema.safeParse({
      kind: "workflow",
      workflowName: "my-workflow",
      args,
    });

    expect(result.success).toBe(false);
  });

  test("accepts a dynamic args function", () => {
    const args = () => ({ orderId: "123" });
    const result = WorkflowOperationSchema.safeParse({
      kind: "workflow",
      workflowName: "my-workflow",
      args,
    });

    const data = expectParseSuccess(result);
    expect(data.args).toBe(args);
  });

  test("keeps generated Executor workflow args aligned with the generated contract", () => {
    type ExecutorWorkflowArgs = Extract<Executor["operation"], { kind: "workflow" }>["args"];

    expectTypeOf<ExecutorWorkflowArgs>().toEqualTypeOf<WorkflowOperationArgs | undefined>();

    // @ts-expect-error Date is neither a JSON-compatible input nor an args callback.
    const invalidArgs: ExecutorWorkflowArgs = new Date();
    void invalidArgs;
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

    const data = expectParseSuccess(result);
    expect(data.operation.kind).toBe("workflow");
    if (data.operation.kind !== "workflow") {
      throw new Error("Expected workflow operation");
    }
    expect(data.operation.workflowName).toBe("test-workflow");
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

    const data = expectParseSuccess(result);
    expect(data.operation.kind).toBe("graphql");
    if (data.operation.kind !== "graphql") {
      throw new Error("Expected graphql operation");
    }
    expect(data.operation.query).toBe("mutation { createUser { id } }");
  });

  test("rejects unknown options on operations", () => {
    expect.hasAssertions();

    expectParseFailure(
      ExecutorSchema.safeParse({
        name: "test-executor",
        trigger: {
          kind: "schedule",
          cron: "0 12 * * *",
        },
        operation: {
          kind: "function",
          body: () => {},
          unknownOption: true,
        },
      }),
    );
  });
});
