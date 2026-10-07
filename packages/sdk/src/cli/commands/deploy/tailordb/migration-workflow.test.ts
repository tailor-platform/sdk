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
  /** Executions of the leftover workflow, newest first. */
  leftoverExecutions?: { id: string; status: WorkflowExecution_Status }[];
  /** Makes the start fail, after the platform created its execution or before. */
  startFailure?: { error: Error; afterCreating: boolean };
  /** Makes listing the executions fail once this run created its workflow. */
  listFailureAfterCreate?: Error;
}

function createMockClient(options: MockClientOptions = {}) {
  const statuses = options.statuses ?? [WorkflowExecution_Status.SUCCESS];
  const calls: string[] = [];
  let statusIndex = 0;
  let workflowExists = options.leftoverWorkflowId !== undefined;
  let workflowCreated = false;
  const executions = [...(options.leftoverExecutions ?? [])];

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
    createWorkflow: vi.fn(() => {
      const created = record("createWorkflow", { workflow: { id: "wf-1" } });
      if (options.failOn !== "createWorkflow") workflowExists = workflowCreated = true;
      return created;
    }),
    startWorkflow: vi.fn(() => {
      calls.push("startWorkflow");
      const failure = options.startFailure;
      if (failure && !failure.afterCreating) return Promise.reject(failure.error);
      executions.unshift({ id: "exec-1", status: WorkflowExecution_Status.PENDING });
      if (failure) return Promise.reject(failure.error);
      return Promise.resolve({ executionId: "exec-1" });
    }),
    listWorkflowExecutions: vi.fn(() => {
      calls.push("listWorkflowExecutions");
      if (workflowCreated && options.listFailureAfterCreate) {
        return Promise.reject(options.listFailureAfterCreate);
      }
      if (!workflowExists) return Promise.reject(new ConnectError("not found", Code.NotFound));
      return Promise.resolve({ executions: [...executions], nextPageToken: "" });
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
    deleteWorkflow: vi.fn(() => {
      const deleted = record("deleteWorkflow", {});
      if (options.failOn !== "deleteWorkflow") executions.length = 0;
      return deleted;
    }),
    deleteWorkflowJobFunction: vi.fn(() => record("deleteWorkflowJobFunction", {})),
    deleteFunctionRegistry: vi.fn(() => record("deleteFunctionRegistry", {})),
  };

  return { client: client as unknown as OperatorClient, raw: client, calls };
}

function deletesAfter(calls: readonly string[], marker: string): string[] {
  expect(calls).toContain(marker);
  return calls.slice(calls.indexOf(marker)).filter((call) => call.startsWith("delete"));
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
      "listWorkflowExecutions",
      "getWorkflowByName",
      "deleteWorkflowJobFunction",
      "deleteFunctionRegistry",
      "createFunctionRegistry",
      "createWorkflowJobFunction",
      "createWorkflow",
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

  test("keeps the workflow when the execution disappears while polling", async () => {
    const { client, raw, calls } = createMockClient();
    raw.getWorkflowExecution.mockResolvedValueOnce({ execution: undefined } as never);

    await expect(run(client)).rejects.toMatchObject({
      code: "MIGRATION_OUTCOME_UNKNOWN",
      cause: expect.objectContaining({ code: "WORKFLOW_EXECUTION_NOT_FOUND" }),
    });
    expect(deletesAfter(calls, "startWorkflow")).toEqual([]);
  });

  test("keeps polling through a transient error", async () => {
    const { client, raw, calls } = createMockClient();
    raw.getWorkflowExecution.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable),
    );

    const result = await run(client);

    expect(result.success).toBe(true);
    expect(raw.getWorkflowExecution).toHaveBeenCalledTimes(2);
    expect(deletesAfter(calls, "startWorkflow")).toContain("deleteWorkflow");
  });

  test("keeps the workflow when polling fails with an error that is not transient", async () => {
    const { client, raw, calls } = createMockClient();
    const lost = new ConnectError("lost", Code.Internal);
    raw.getWorkflowExecution.mockRejectedValueOnce(lost);

    await expect(run(client)).rejects.toMatchObject({
      code: "MIGRATION_OUTCOME_UNKNOWN",
      message: expect.stringContaining("tailordb/0003"),
      context: expect.objectContaining({ executionId: "exec-1" }),
      cause: lost,
    });
    expect(deletesAfter(calls, "startWorkflow")).toEqual([]);
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

  test.each(
    [Code.InvalidArgument, Code.NotFound, Code.PermissionDenied, Code.Unauthenticated].map(
      (code) => ({ code, codeName: Code[code] }),
    ),
  )("tears the run down when the platform refuses to start it with $codeName", async ({ code }) => {
    const error = new ConnectError("refused", code);
    const { client, calls } = createMockClient({
      startFailure: { error, afterCreating: false },
    });

    await expect(run(client)).rejects.toBe(error);
    expect(deletesAfter(calls, "startWorkflow")).toEqual([
      "deleteWorkflow",
      "deleteWorkflowJobFunction",
      "deleteFunctionRegistry",
    ]);
  });

  test("waits for the execution a start created before its response was lost", async () => {
    const { client, raw, calls } = createMockClient({
      startFailure: { error: new ConnectError("lost", Code.Unavailable), afterCreating: true },
    });

    const result = await run(client);

    expect(result.success).toBe(true);
    expect(raw.getWorkflowExecution).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      executionId: "exec-1",
    });
    expect(deletesAfter(calls, "getWorkflowExecution")).toContain("deleteWorkflow");
  });

  test("finds the execution through a transient error while looking it up", async () => {
    const { client, raw } = createMockClient({
      startFailure: { error: new TypeError("fetch failed"), afterCreating: true },
    });
    const list = raw.listWorkflowExecutions.getMockImplementation()!;
    raw.listWorkflowExecutions
      .mockImplementationOnce(list)
      .mockRejectedValueOnce(new ConnectError("unavailable", Code.Unavailable));

    const result = await run(client);

    expect(result.success).toBe(true);
    expect(raw.listWorkflowExecutions).toHaveBeenCalledTimes(3);
  });

  test.each([
    { name: "no execution is listed", options: {} },
    {
      name: "the executions cannot be listed",
      options: { listFailureAfterCreate: new ConnectError("lost", Code.Internal) },
    },
  ])("keeps the workflow when a start fails ambiguously and $name", async ({ options }) => {
    const lost = new ConnectError("lost", Code.Unavailable);
    const { client, calls } = createMockClient({
      ...options,
      startFailure: { error: lost, afterCreating: false },
    });

    await expect(run(client)).rejects.toMatchObject({
      code: "MIGRATION_OUTCOME_UNKNOWN",
      message: "Could not confirm whether migration tailordb/0003 started: [unavailable] lost",
      suggestion: expect.stringContaining(
        "tailor workflow executions --workflow-name tailordb-migration--tailordb--0003",
      ),
      cause: lost,
    });
    expect(deletesAfter(calls, "startWorkflow")).toEqual([]);
  });

  test("names both checkpoints to sync to once the outcome is known", async () => {
    const { client } = createMockClient({
      startFailure: { error: new ConnectError("lost", Code.Unavailable), afterCreating: false },
    });

    await expect(run(client)).rejects.toMatchObject({
      suggestion: expect.stringMatching(
        /succeeded, run 'tailor tailordb migration sync 0003 --namespace tailordb'.*otherwise run 'tailor tailordb migration sync 0002 --namespace tailordb'/,
      ),
    });
  });

  test("refuses to replace a leftover workflow whose execution is still running", async () => {
    const { client, raw } = createMockClient({
      leftoverWorkflowId: "stale-wf",
      leftoverExecutions: [{ id: "exec-0", status: WorkflowExecution_Status.RUNNING }],
    });

    await expect(run(client)).rejects.toMatchObject({
      code: "MIGRATION_OUTCOME_UNKNOWN",
      message: expect.stringContaining("exec-0"),
      context: expect.objectContaining({ executionId: "exec-0" }),
    });
    expect(raw.deleteWorkflow).not.toHaveBeenCalled();
    expect(raw.createFunctionRegistry).not.toHaveBeenCalled();
  });

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
