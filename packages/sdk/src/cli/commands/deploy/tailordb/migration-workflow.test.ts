import * as crypto from "node:crypto";
import { Code, ConnectError } from "@connectrpc/connect";
import { WorkflowExecution_Status } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { writeMetadataLabelsDirect } from "../label";
import {
  executeMigrationAsWorkflow,
  MigrationExecutionInFlightError,
  migrationWorkflowResourceName,
} from "./migration-workflow";
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
  /** Executions of the leftover workflow, as the platform lists them. */
  leftoverExecutions?: { id: string; status: WorkflowExecution_Status }[];
  /** Content hash of the leftover function; defaults to the hash of the bundled code. */
  leftoverContentHash?: string;
  /** The leftover function is already gone. */
  leftoverFunctionMissing?: boolean;
  /** Return the leftover executions one per page. */
  paginateLeftoverExecutions?: boolean;
}

const bundledCode = "// bundled";
const bundledCodeHash = crypto.createHash("sha256").update(bundledCode, "utf-8").digest("hex");

function createMockClient(options: MockClientOptions = {}) {
  const statuses = options.statuses ?? [WorkflowExecution_Status.SUCCESS];
  const calls: string[] = [];
  let statusIndex = 0;

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
    listWorkflowExecutions: vi.fn(({ pageToken }: { pageToken: string }) => {
      calls.push("listWorkflowExecutions");
      // The platform rejects the listing when the workflow itself is missing.
      if (options.leftoverWorkflowId === undefined) {
        return Promise.reject(new ConnectError("workflow not found", Code.NotFound));
      }
      const all = (options.leftoverExecutions ?? []).map((execution) => ({
        ...execution,
        jobExecutions: [],
      }));
      if (!options.paginateLeftoverExecutions) {
        return Promise.resolve({ executions: all, nextPageToken: "" });
      }
      const index = pageToken ? Number(pageToken) : 0;
      const next = index + 1 < all.length ? String(index + 1) : "";
      return Promise.resolve({ executions: all.slice(index, index + 1), nextPageToken: next });
    }),
    getFunctionRegistry: vi.fn(() => {
      calls.push("getFunctionRegistry");
      if (options.leftoverFunctionMissing) {
        return Promise.reject(new ConnectError("not found", Code.NotFound));
      }
      return Promise.resolve({
        function: { contentHash: options.leftoverContentHash ?? bundledCodeHash },
      });
    }),
    createFunctionRegistry: vi.fn(() => record("createFunctionRegistry", {})),
    createWorkflowJobFunction: vi.fn(() =>
      record("createWorkflowJobFunction", { jobFunction: { version: 1n } }),
    ),
    createWorkflow: vi.fn(() => record("createWorkflow", { workflow: { id: "wf-1" } })),
    startWorkflow: vi.fn(() => record("startWorkflow", { executionId: "exec-1" })),
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
          logs: options.logs ?? "",
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
    code: bundledCode,
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
    vi.mocked(logger.info).mockClear();
    vi.mocked(writeMetadataLabelsDirect).mockClear();
  });

  test("registers, starts, and tears down the temporary resources", async () => {
    const { client, raw, calls } = createMockClient();

    const result = await run(client);

    expect(result.success).toBe(true);
    expect(calls).toEqual([
      // No leftovers, so the reclaim sweep only probes for stale resources.
      "getWorkflowByName",
      "listWorkflowExecutions",
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

  test("tears the temporary resources down even when the start call fails", async () => {
    const { client, calls } = createMockClient({ failOn: "startWorkflow" });

    await expect(run(client)).rejects.toThrow("startWorkflow failed");

    expect(calls).toContain("deleteWorkflow");
    expect(calls).toContain("deleteWorkflowJobFunction");
    expect(calls).toContain("deleteFunctionRegistry");
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
    expect(raw.deleteWorkflowJobFunction).toHaveBeenCalled();
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

  test("adopts an in-flight execution of the leftover workflow instead of rerunning the script", async () => {
    const { client, raw, calls } = createMockClient({
      leftoverWorkflowId: "stale-wf",
      leftoverExecutions: [{ id: "exec-old", status: WorkflowExecution_Status.RUNNING }],
      statuses: [WorkflowExecution_Status.RUNNING, WorkflowExecution_Status.SUCCESS],
      logs: "INFO backfill done",
    });

    const result = await run(client);

    expect(result).toEqual({ success: true, logs: "INFO backfill done" });
    expect(raw.getWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: "exec-old" }),
    );
    // Nothing is recreated or started; the leftovers are torn down once the
    // adopted execution finished.
    expect(calls).not.toContain("createFunctionRegistry");
    expect(calls).not.toContain("startWorkflow");
    expect(calls.slice(-3)).toEqual([
      "deleteWorkflow",
      "deleteWorkflowJobFunction",
      "deleteFunctionRegistry",
    ]);
    expect(raw.deleteWorkflow).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      workflowId: "stale-wf",
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("still running from an earlier deployment"),
    );
  });

  test("reports the adopted execution's failure as this run's outcome", async () => {
    const { client } = createMockClient({
      leftoverWorkflowId: "stale-wf",
      leftoverExecutions: [{ id: "exec-old", status: WorkflowExecution_Status.PENDING }],
      statuses: [WorkflowExecution_Status.FAILED],
      errorMessage: "duplicate key",
    });

    const result = await run(client);

    expect(result.success).toBe(false);
    expect(result.error).toBe("duplicate key");
  });

  test("tears down a leftover whose executions all finished", async () => {
    const { client, calls } = createMockClient({
      leftoverWorkflowId: "stale-wf",
      leftoverExecutions: [
        { id: "exec-old", status: WorkflowExecution_Status.FAILED },
        { id: "exec-older", status: WorkflowExecution_Status.SUCCESS },
      ],
    });

    const result = await run(client);

    expect(result.success).toBe(true);
    expect(calls.indexOf("deleteWorkflow")).toBeLessThan(calls.indexOf("createFunctionRegistry"));
  });

  test("refuses to touch a leftover running a different script version", async () => {
    const { client, calls } = createMockClient({
      leftoverWorkflowId: "stale-wf",
      leftoverExecutions: [{ id: "exec-old", status: WorkflowExecution_Status.RUNNING }],
      leftoverContentHash: "other-hash",
    });

    await expect(run(client)).rejects.toThrow(
      "could not be confirmed to match the current migrate.ts",
    );

    // The earlier run's resources stay in place: deleting them would not stop
    // the execution that still uses them.
    expect(calls).not.toContain("deleteWorkflow");
    expect(calls).not.toContain("deleteFunctionRegistry");
  });

  test("refuses when the leftover function is gone, without touching the workflow", async () => {
    const { client, calls } = createMockClient({
      leftoverWorkflowId: "stale-wf",
      leftoverExecutions: [{ id: "exec-old", status: WorkflowExecution_Status.RUNNING }],
      leftoverFunctionMissing: true,
    });

    await expect(run(client)).rejects.toThrow(MigrationExecutionInFlightError);
    expect(calls).not.toContain("deleteWorkflow");
  });

  test("pages through the leftover workflow's executions before deciding", async () => {
    const { client, raw, calls } = createMockClient({
      leftoverWorkflowId: "stale-wf",
      leftoverExecutions: [
        { id: "exec-done", status: WorkflowExecution_Status.SUCCESS },
        { id: "exec-live", status: WorkflowExecution_Status.RUNNING },
      ],
      paginateLeftoverExecutions: true,
      statuses: [WorkflowExecution_Status.SUCCESS],
    });

    const result = await run(client);

    expect(result.success).toBe(true);
    expect(calls.filter((call) => call === "listWorkflowExecutions")).toHaveLength(2);
    expect(raw.getWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: "exec-live" }),
    );
  });

  test("refuses when several executions of the leftover are still unfinished", async () => {
    const { client, calls } = createMockClient({
      leftoverWorkflowId: "stale-wf",
      leftoverExecutions: [
        { id: "exec-a", status: WorkflowExecution_Status.RUNNING },
        { id: "exec-b", status: WorkflowExecution_Status.PENDING_RETRY },
      ],
    });

    await expect(run(client)).rejects.toThrow("2 unfinished executions");
    expect(calls).not.toContain("deleteWorkflow");
  });

  test.each([
    ["WAITING", WorkflowExecution_Status.WAITING],
    ["PENDING_RESUME", WorkflowExecution_Status.PENDING_RESUME],
  ])("refuses when the leftover execution is %s for a resume", async (_label, status) => {
    const { client, calls } = createMockClient({
      leftoverWorkflowId: "stale-wf",
      leftoverExecutions: [{ id: "exec-a", status }],
    });

    await expect(run(client)).rejects.toThrow("waiting to be resumed");
    expect(calls).not.toContain("deleteWorkflow");
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
