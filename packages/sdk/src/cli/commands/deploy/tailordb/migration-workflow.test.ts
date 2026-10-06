import { Code, ConnectError } from "@connectrpc/connect";
import { WorkflowExecution_Status } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { writeMetadataLabelsDirect } from "../label";
import { executeMigrationAsWorkflow, migrationWorkflowResourceName } from "./migration-workflow";
import type { OperatorClient } from "#/cli/shared/client";
import type { AuthInvoker } from "@tailor-platform/tailor-proto/auth_resource_pb";

vi.mock("#/cli/shared/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    newline: vi.fn(),
    log: vi.fn(),
  },
  styles: { bold: (s: string) => s },
}));

vi.mock("../label", async (importOriginal) => ({
  ...(await importOriginal()),
  resourceTrn: (workspaceId: string, kind: string, name: string) =>
    `trn:v1:workspace:${workspaceId}:${kind}:${name}`,
  writeMetadataLabelsDirect: vi.fn(),
  buildMetaRequest: vi.fn(async (params: unknown) => params),
}));

const invoker = { namespace: "auth", machineUserName: "migrator" } as AuthInvoker;

interface MockClientOptions {
  statuses?: WorkflowExecution_Status[];
  logs?: string;
  /** Structured error the migration script threw, as the platform reports it. */
  errorMessage?: string;
  /** Execution result, which carries the failure reason when error info is absent. */
  executionResult?: string;
  failOn?: string;
  failWith?: Error;
  /** Workflow left behind by an earlier interrupted run of the same migration. */
  leftoverWorkflowId?: string;
  /** Makes starting the run fail, after the platform created its execution or before. */
  startFailure?: { error: Error; afterCreating: boolean };
  /** Executions of the migration's workflow name that exist before this run starts. */
  priorExecutionIds?: string[];
  /** Errors the execution listing rejects with, in order, once the start has failed. */
  listFailuresAfterStart?: Error[];
}

function createMockClient(options: MockClientOptions = {}) {
  const statuses = options.statuses ?? [WorkflowExecution_Status.SUCCESS];
  const calls: string[] = [];
  let statusIndex = 0;
  let executionCreated = false;
  let startAttempted = false;
  const pendingListFailures = [...(options.listFailuresAfterStart ?? [])];

  const record = <T>(name: string, value: T) => {
    calls.push(name);
    if (options.failOn === name) {
      return Promise.reject(options.failWith ?? new Error(`${name} failed`));
    }
    return Promise.resolve(value);
  };

  const client = {
    getWorkflowByName: vi.fn(() => {
      calls.push("getWorkflowByName");
      if (options.leftoverWorkflowId === undefined) {
        return Promise.reject(new ConnectError("not found", Code.NotFound));
      }
      return Promise.resolve({ workflow: { id: options.leftoverWorkflowId } });
    }),
    createFunctionRegistry: vi.fn(() => record("createFunctionRegistry", {})),
    createWorkflowJobFunction: vi.fn(() =>
      record("createWorkflowJobFunction", { jobFunction: { version: 1n } }),
    ),
    createWorkflow: vi.fn(() => record("createWorkflow", { workflow: { id: "wf-1" } })),
    startWorkflow: vi.fn(() => {
      const failure = options.startFailure;
      if (!failure) return record("startWorkflow", { executionId: "exec-1" });
      calls.push("startWorkflow");
      startAttempted = true;
      executionCreated = failure.afterCreating;
      return Promise.reject(failure.error);
    }),
    listWorkflowExecutions: vi.fn(() => {
      calls.push("listWorkflowExecutions");
      const failure = startAttempted ? pendingListFailures.shift() : undefined;
      if (failure) return Promise.reject(failure);
      return Promise.resolve({
        executions: [
          ...(options.priorExecutionIds ?? []).map((id) => ({ id })),
          ...(executionCreated ? [{ id: "exec-1" }] : []),
        ],
      });
    }),
    getWorkflowExecution: vi.fn(() => {
      calls.push("getWorkflowExecution");
      const status = statuses[Math.min(statusIndex, statuses.length - 1)]!;
      statusIndex++;
      return Promise.resolve({
        execution: {
          status,
          jobExecutions: [{ executionId: "fn-1" }],
        },
      });
    }),
    getFunctionExecution: vi.fn(() =>
      Promise.resolve({
        execution: {
          logEntries: (options.logs ?? "")
            .split("\n")
            .filter(Boolean)
            .map((message) => ({ message })),
          error: options.errorMessage ? { message: options.errorMessage } : undefined,
          result: options.executionResult ?? "",
        },
      }),
    ),
    deleteWorkflow: vi.fn(() => record("deleteWorkflow", {})),
    deleteWorkflowJobFunction: vi.fn(() => record("deleteWorkflowJobFunction", {})),
    deleteFunctionRegistry: vi.fn(() => record("deleteFunctionRegistry", {})),
  };

  return { client: client as unknown as OperatorClient, raw: client, calls };
}

function run(client: OperatorClient) {
  return executeMigrationAsWorkflow({
    client,
    workspaceId: "ws-1",
    code: "// bundled",
    namespace: "tailordb",
    migrationNumber: 3,
    invoker,
    appName: "my-app",
    appId: "app-1",
    pollIntervalMs: 0,
  });
}

describe("migrationWorkflowResourceName", () => {
  test("pads the migration number so the name is stable per migration", () => {
    expect(migrationWorkflowResourceName("tailordb", 3)).toBe("tailordb-migration--tailordb--0003");
  });
});

describe("executeMigrationAsWorkflow", () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
    vi.mocked(writeMetadataLabelsDirect).mockClear();
  });

  test("registers, starts, and tears down the temporary resources", async () => {
    const { client, raw, calls } = createMockClient();

    const result = await run(client);

    expect(result.success).toBe(true);
    expect(calls).toEqual([
      // No leftovers, so the reclaim sweep only probes for a stale workflow.
      "getWorkflowByName",
      "deleteWorkflowJobFunction",
      "deleteFunctionRegistry",
      "createFunctionRegistry",
      "createWorkflowJobFunction",
      "createWorkflow",
      "listWorkflowExecutions",
      "startWorkflow",
      "getWorkflowExecution",
      "deleteWorkflow",
      "deleteWorkflowJobFunction",
      "deleteFunctionRegistry",
    ]);
    expect(raw.createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowName: "tailordb-migration--tailordb--0003",
        mainJobFunctionName: "tailordb-migration--tailordb--0003",
        jobFunctions: { "tailordb-migration--tailordb--0003": 1n },
      }),
    );
  });

  test("polls until the execution reaches a terminal status", async () => {
    const { client, raw } = createMockClient({
      statuses: [
        WorkflowExecution_Status.PENDING,
        WorkflowExecution_Status.RUNNING,
        WorkflowExecution_Status.SUCCESS,
      ],
    });

    const result = await run(client);

    expect(result.success).toBe(true);
    expect(raw.getWorkflowExecution).toHaveBeenCalledTimes(3);
  });

  test("fails when the execution disappears while polling", async () => {
    const { client, raw, calls } = createMockClient();
    raw.getWorkflowExecution.mockResolvedValueOnce({ execution: undefined } as never);

    await expect(run(client)).rejects.toMatchObject({ code: "WORKFLOW_EXECUTION_NOT_FOUND" });
    expect(calls).toContain("deleteWorkflow");
  });

  test("stops polling on a transient error", async () => {
    const { client, raw, calls } = createMockClient();
    raw.getWorkflowExecution.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable),
    );

    await expect(run(client)).rejects.toThrow("unavailable");
    expect(raw.getWorkflowExecution).toHaveBeenCalledTimes(1);
    expect(calls).toContain("deleteWorkflow");
  });

  test("reports failure with the logs of the failed execution", async () => {
    const { client } = createMockClient({
      statuses: [WorkflowExecution_Status.FAILED],
      logs: "INFO starting\nERROR relation does not exist",
    });

    const result = await run(client);

    expect(result.success).toBe(false);
    expect(result.logs).toContain("relation does not exist");
    expect(result.error).toContain("relation does not exist");
  });

  test("reports the error the migration script threw rather than a log line", async () => {
    const { client } = createMockClient({
      statuses: [WorkflowExecution_Status.FAILED],
      logs: "INFO backfilling users",
      errorMessage: "simulated migration failure",
    });

    const result = await run(client);

    expect(result.success).toBe(false);
    // Without this the caller only sees a generic "workflow execution failed",
    // because the thrown error never reaches the job logs.
    expect(result.error).toBe("simulated migration failure");
  });

  test("falls back to the execution result when no structured error is reported", async () => {
    const { client } = createMockClient({
      statuses: [WorkflowExecution_Status.FAILED],
      executionResult: "constraint violation on users.email",
    });

    const result = await run(client);

    expect(result.success).toBe(false);
    expect(result.error).toBe("constraint violation on users.email");
  });

  test("reports failure when the execution is canceled", async () => {
    const { client } = createMockClient({
      statuses: [WorkflowExecution_Status.CANCELED],
      logs: "INFO backfilling users",
    });

    const result = await run(client);

    expect(result.success).toBe(false);
    expect(result.logs).toBe("INFO backfilling users");
    expect(result.error).toBe("Migration workflow execution was canceled.");
  });

  test("tears the temporary resources down even when the start call fails", async () => {
    const { client, calls } = createMockClient({ failOn: "startWorkflow" });

    await expect(run(client)).rejects.toThrow("startWorkflow failed");

    expect(calls).toContain("deleteWorkflow");
    expect(calls).toContain("deleteWorkflowJobFunction");
    expect(calls).toContain("deleteFunctionRegistry");
  });

  test.each([
    { name: "Unavailable", error: new ConnectError("lost", Code.Unavailable) },
    { name: "DeadlineExceeded", error: new ConnectError("lost", Code.DeadlineExceeded) },
    { name: "Internal", error: new ConnectError("lost", Code.Internal) },
    { name: "a dropped connection", error: new TypeError("fetch failed") },
  ])(
    "waits for the execution that a start with a lost response created ($name)",
    async ({ error }) => {
      const { client, raw, calls } = createMockClient({
        startFailure: { error, afterCreating: true },
      });

      const result = await run(client);

      expect(result.success).toBe(true);
      expect(raw.getWorkflowExecution).toHaveBeenCalledWith(
        expect.objectContaining({ executionId: "exec-1" }),
      );
      const afterStart = calls.slice(calls.indexOf("startWorkflow"));
      expect(afterStart.indexOf("getWorkflowExecution")).toBeLessThan(
        afterStart.findIndex((call) => call.startsWith("delete")),
      );
    },
  );

  test("looks for the execution again when the lookup fails with a transient error", async () => {
    const { client, raw } = createMockClient({
      startFailure: { error: new ConnectError("lost", Code.Unavailable), afterCreating: true },
      listFailuresAfterStart: [
        new ConnectError("busy", Code.Unavailable),
        new ConnectError("busy", Code.ResourceExhausted),
      ],
    });

    const result = await run(client);

    expect(result.success).toBe(true);
    // Once before the start, then three lookups after it.
    expect(raw.listWorkflowExecutions).toHaveBeenCalledTimes(4);
  });

  test("gives up on the lookup after five transient failures", async () => {
    const lookupError = new ConnectError("busy", Code.Unavailable);
    const { client, raw, calls } = createMockClient({
      startFailure: { error: new ConnectError("lost", Code.Unavailable), afterCreating: true },
      listFailuresAfterStart: Array.from({ length: 5 }, () => lookupError),
    });

    await expect(run(client)).rejects.toBe(lookupError);

    expect(raw.listWorkflowExecutions).toHaveBeenCalledTimes(6);
    expect(calls).toContain("deleteWorkflow");
  });

  test("does not retry the lookup when it fails with an error that is not transient", async () => {
    const lookupError = new ConnectError("denied", Code.PermissionDenied);
    const { client, raw } = createMockClient({
      startFailure: { error: new ConnectError("lost", Code.Unavailable), afterCreating: true },
      listFailuresAfterStart: [lookupError],
    });

    await expect(run(client)).rejects.toBe(lookupError);

    expect(raw.listWorkflowExecutions).toHaveBeenCalledTimes(2);
  });

  test("tears down and rethrows when a start with a lost response created no execution", async () => {
    const error = new ConnectError("lost", Code.Unavailable);
    const { client, calls } = createMockClient({ startFailure: { error, afterCreating: false } });

    await expect(run(client)).rejects.toBe(error);

    expect(calls).toContain("deleteWorkflow");
  });

  test("does not take an execution that existed before the start for the one it started", async () => {
    const error = new ConnectError("lost", Code.Unavailable);
    const { client, raw } = createMockClient({
      startFailure: { error, afterCreating: false },
      priorExecutionIds: ["exec-old"],
    });

    await expect(run(client)).rejects.toBe(error);

    expect(raw.getWorkflowExecution).not.toHaveBeenCalled();
  });

  test.each(
    [Code.InvalidArgument, Code.NotFound, Code.PermissionDenied, Code.Unauthenticated].map(
      (code) => ({ code, codeName: Code[code] }),
    ),
  )(
    "does not look for an execution when the platform refuses the start with $codeName",
    async ({ code }) => {
      const error = new ConnectError("refused", code);
      const { client, raw, calls } = createMockClient({
        startFailure: { error, afterCreating: false },
      });

      await expect(run(client)).rejects.toBe(error);

      expect(raw.listWorkflowExecutions).toHaveBeenCalledTimes(1);
      expect(calls).toContain("deleteWorkflow");
    },
  );

  test("keeps the migration result when teardown fails", async () => {
    const { client } = createMockClient({ failOn: "deleteWorkflow" });

    const result = await run(client);

    expect(result.success).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Could not remove"));
  });

  test("stays quiet when a temporary resource is already gone", async () => {
    const { client } = createMockClient({
      failOn: "deleteWorkflow",
      failWith: new ConnectError("not found", Code.NotFound),
    });

    const result = await run(client);

    expect(result.success).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("does not attempt to delete a workflow that was never created", async () => {
    const { client, raw } = createMockClient({ failOn: "createWorkflow" });

    await expect(run(client)).rejects.toThrow("createWorkflow failed");

    expect(raw.deleteWorkflow).not.toHaveBeenCalled();
    expect(raw.deleteWorkflowJobFunction).toHaveBeenCalledTimes(2);
  });

  test("reclaims an interrupted run's leftovers before recreating them", async () => {
    const { client, raw, calls } = createMockClient({ leftoverWorkflowId: "stale-wf" });

    const result = await run(client);

    expect(result.success).toBe(true);
    // The stale workflow is deleted by id before the create path runs, so
    // `createFunctionRegistry` cannot fail on a name collision.
    expect(raw.deleteWorkflow).toHaveBeenNthCalledWith(1, {
      workspaceId: "ws-1",
      workflowId: "stale-wf",
    });
    expect(calls.indexOf("deleteFunctionRegistry")).toBeLessThan(
      calls.indexOf("createFunctionRegistry"),
    );
  });

  test("labels every temporary resource immediately rather than via the deploy batch", async () => {
    const { client } = createMockClient();

    await run(client);

    const labeled = vi
      .mocked(writeMetadataLabelsDirect)
      .mock.calls.map(([, write]) => (write as { trn: string }).trn);
    const name = "tailordb-migration--tailordb--0003";
    expect(labeled).toEqual([
      `trn:v1:workspace:ws-1:function_registry:${name}`,
      `trn:v1:workspace:ws-1:workflow_job_function:${name}`,
      `trn:v1:workspace:ws-1:workflow:${name}`,
    ]);
  });
});
