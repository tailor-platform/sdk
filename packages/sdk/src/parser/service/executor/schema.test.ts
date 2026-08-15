import * as v from "valibot";
import { describe, expect, expectTypeOf, test } from "vitest";
import {
  ExecutorSchema,
  FunctionOperationSchema,
  GqlOperationSchema,
  WorkflowExecutionTriggerSchema,
  WorkflowJobExecutionTriggerSchema,
  WorkflowOperationSchema,
} from "./schema";
import type { Executor, ExecutorInput, WorkflowOperationArgs } from "#/types/executor.generated";

function expectParseSuccess<T>(result: v.SafeParseResult<v.GenericSchema<unknown, T>>): T {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error("Expected schema parsing to succeed");
  }
  return result.output;
}

function expectParseFailure<T>(
  result: v.SafeParseResult<v.GenericSchema<unknown, T>>,
): [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]] {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected schema parsing to fail");
  }
  return result.issues;
}

function expectUnknownKeyRejected<T>(result: v.SafeParseResult<v.GenericSchema<unknown, T>>) {
  const issues = expectParseFailure(result);
  expect(issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "strict_object",
      }),
    ]),
  );
}

describe("FunctionOperationSchema", () => {
  test("rejects unknown options", () => {
    expect.hasAssertions();

    expectUnknownKeyRejected(
      v.safeParse(FunctionOperationSchema, {
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
    const result = v.safeParse(GqlOperationSchema, { kind: "graphql", query });
    const data = expectParseSuccess(result);
    expect(data.query).toBe("query { users { id } }");
  });

  test("rejects unknown options", () => {
    expect.hasAssertions();

    expectUnknownKeyRejected(
      v.safeParse(GqlOperationSchema, {
        kind: "graphql",
        query: "query { users { id } }",
        unknownOption: true,
      }),
    );
  });
});

describe("WorkflowOperationSchema", () => {
  test("extracts workflowName from workflow object", () => {
    const result = v.safeParse(WorkflowOperationSchema, {
      kind: "workflow",
      workflow: { name: "my-workflow" },
      args: { id: "123" },
    });

    const data = expectParseSuccess(result);
    expect(data.workflowName).toBe("my-workflow");
    expect(data).not.toHaveProperty("workflow");
  });

  test("prefers workflow object name when workflowName is also present", () => {
    const result = v.safeParse(WorkflowOperationSchema, {
      kind: "workflow",
      workflowName: "stale-workflow",
      workflow: { name: "current-workflow" },
      args: { id: "123" },
    });

    const data = expectParseSuccess(result);
    expect(data.workflowName).toBe("current-workflow");
  });

  test("rejects a malformed workflow object even when workflowName is present", () => {
    const result = v.safeParse(WorkflowOperationSchema, {
      kind: "workflow",
      workflowName: "stale-workflow",
      workflow: {},
      args: { id: "123" },
    });

    expect(result.success).toBe(false);
  });

  test("accepts workflowName directly", () => {
    const result = v.safeParse(WorkflowOperationSchema, {
      kind: "workflow",
      workflowName: "my-workflow",
      args: { id: "123" },
    });

    const data = expectParseSuccess(result);
    expect(data.workflowName).toBe("my-workflow");
  });

  test("rejects unknown options", () => {
    expect.hasAssertions();

    const issues = expectParseFailure(
      v.safeParse(WorkflowOperationSchema, {
        kind: "workflow",
        workflowName: "my-workflow",
        unknownOption: true,
      }),
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "union",
          issues: expect.arrayContaining([
            expect.objectContaining({
              type: "strict_object",
            }),
          ]),
        }),
      ]),
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
    const result = v.safeParse(WorkflowOperationSchema, {
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
    ["nested undefined", { nested: undefined }],
    ["nested Date", { nested: new Date("2026-01-01T00:00:00.000Z") }],
    ["nested Map", [new Map([["key", "value"]])]],
  ])("rejects unsupported %s static args", (_description, args) => {
    const result = v.safeParse(WorkflowOperationSchema, {
      kind: "workflow",
      workflowName: "my-workflow",
      args,
    });

    expect(result.success).toBe(false);
  });

  test("accepts a dynamic args function", () => {
    const args = () => ({ orderId: "123" });
    const result = v.safeParse(WorkflowOperationSchema, {
      kind: "workflow",
      workflowName: "my-workflow",
      args,
    });

    const data = expectParseSuccess(result);
    expect(data.args).toBe(args);
  });

  test("returns the validated copy of static args", () => {
    let reads = 0;
    const args = {
      get value() {
        reads += 1;
        return "stable";
      },
    };
    const result = v.safeParse(WorkflowOperationSchema, {
      kind: "workflow",
      workflowName: "my-workflow",
      args,
    });

    const data = expectParseSuccess(result);
    expect(data.args).not.toBe(args);
    expect(data.args).toEqual({ value: "stable" });
    const readsAfterParse = reads;
    expect(JSON.stringify(data.args)).toBe('{"value":"stable"}');
    expect(reads).toBe(readsAfterParse);
  });

  test("keeps generated Executor workflow args aligned with the generated contract", () => {
    type ExecutorWorkflowArgs = Extract<Executor["operation"], { kind: "workflow" }>["args"];

    expectTypeOf<ExecutorWorkflowArgs>().toEqualTypeOf<WorkflowOperationArgs | undefined>();

    // @ts-expect-error Date is neither a JSON-compatible input nor an args callback.
    const invalidArgs: ExecutorWorkflowArgs = new Date();
    void invalidArgs;
  });

  test("keeps generated workflow operation input aligned with reference parsing", () => {
    type WorkflowReferenceInput = Extract<
      ExecutorInput["operation"],
      { kind: "workflow"; workflow: unknown }
    >;

    expectTypeOf<WorkflowReferenceInput>().not.toBeAny();
    expectTypeOf<WorkflowReferenceInput>().not.toBeUnknown();
    expectTypeOf<WorkflowReferenceInput>().not.toBeNever();

    const executor: ExecutorInput = {
      name: "test-executor",
      trigger: { kind: "schedule", cron: "0 12 * * *" },
      operation: {
        kind: "workflow",
        workflow: { name: "my-workflow" },
        args: { orderId: "123" },
      },
    };

    const invalidExecutor: ExecutorInput = {
      ...executor,
      operation: {
        kind: "workflow",
        // @ts-expect-error Workflow references require a name.
        workflow: {},
      },
    };
    void invalidExecutor;

    expect(executor.operation.kind).toBe("workflow");
  });
});

describe("workflow execution trigger schemas", () => {
  test.each([
    [
      "workflow execution",
      WorkflowExecutionTriggerSchema,
      "workflowExecution",
      "workflow.workflow_execution.started",
    ],
    [
      "workflow job execution",
      WorkflowJobExecutionTriggerSchema,
      "workflowJobExecution",
      "workflow.workflow_execution.job_execution.started",
    ],
  ] as const)(
    "rejects blank workflow names for %s triggers",
    (_description, schema, kind, event) => {
      expect(v.safeParse(schema, { kind, events: [event], workflowName: "" }).success).toBe(false);
      expect(v.safeParse(schema, { kind, events: [event], workflowName: "  " }).success).toBe(
        false,
      );
    },
  );
});

describe("ExecutorSchema", () => {
  test("transforms workflow executor correctly", () => {
    const result = v.safeParse(ExecutorSchema, {
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

    const result = v.safeParse(ExecutorSchema, {
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
      v.safeParse(ExecutorSchema, {
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
