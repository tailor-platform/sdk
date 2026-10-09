import * as crypto from "node:crypto";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { writeMetadataLabelsDirect } from "../label";
import {
  executeMigrationAsWorkflow,
  MIGRATION_SCRIPT_STARTED_LOG,
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
}

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

describe("observing when the migration script runs", () => {
  interface PollSpec {
    status: WorkflowExecution_Status;
    jobs: { executionId: string; status: WorkflowJobExecution_Status }[];
  }

  function observedClient(polls: PollSpec[], logsByCall: Record<string, string[][]>) {
    const { client, raw } = createMockClient();
    let poll = 0;
    raw.getWorkflowExecution.mockImplementation(() => {
      const spec = polls[Math.min(poll, polls.length - 1)]!;
      poll++;
      return Promise.resolve({
        execution: { status: spec.status, jobExecutions: spec.jobs },
      });
    });
    const fetched = new Map<string, number>();
    raw.getFunctionExecution.mockImplementation((({ executionId }: { executionId: string }) => {
      const sequence = logsByCall[executionId] ?? [[]];
      const index = fetched.get(executionId) ?? 0;
      fetched.set(executionId, index + 1);
      const messages = sequence[Math.min(index, sequence.length - 1)]!;
      return Promise.resolve({
        execution: { logEntries: messages.map((message) => ({ message })), result: "" },
      });
    }) as never);
    return { client, raw };
  }

  function runObserved(client: OperatorClient) {
    const events: string[] = [];
    const result = executeMigrationAsWorkflow({
      client,
      workspaceId: "ws-1",
      code: "// bundled",
      namespace: "tailordb",
      migrationNumber: 3,
      invoker,
      appName: "my-app",
      appId: "app-1",
      pollIntervalMs: 0,
      onRunEvent: (event) => {
        if (event.type === "finished") events.push(`finished:${event.scriptStarted}`);
        else if (event.type !== "polled") events.push(event.type);
      },
    });
    return { result, events };
  }

  const running = WorkflowJobExecution_Status.RUNNING;
  const succeeded = WorkflowJobExecution_Status.SUCCESS;

  test("uploads the script behind a log line that marks its start", async () => {
    const { client, raw } = createMockClient();

    await run(client);

    const [stream] = raw.createFunctionRegistry.mock.calls[0] as unknown as [
      AsyncIterable<{ payload: { case: string; value: unknown } }>,
    ];
    let info: { sizeBytes: bigint; contentHash: string } | undefined;
    const chunks: Uint8Array[] = [];
    for await (const message of stream) {
      if (message.payload.case === "info") info = message.payload.value as typeof info;
      else chunks.push(message.payload.value as Uint8Array);
    }
    const uploaded = Buffer.concat(chunks).toString("utf-8");
    expect(uploaded).toBe(
      `console.log(${JSON.stringify(MIGRATION_SCRIPT_STARTED_LOG)});\n// bundled`,
    );
    expect(info).toMatchObject({
      sizeBytes: BigInt(Buffer.byteLength(uploaded)),
      contentHash: crypto.createHash("sha256").update(uploaded, "utf-8").digest("hex"),
    });
  });

  test("reports waiting until a running job logs the start, then running", async () => {
    const { client } = observedClient(
      [
        { status: WorkflowExecution_Status.PENDING, jobs: [] },
        {
          status: WorkflowExecution_Status.RUNNING,
          jobs: [{ executionId: "fn-1", status: running }],
        },
        {
          status: WorkflowExecution_Status.RUNNING,
          jobs: [{ executionId: "fn-1", status: running }],
        },
        {
          status: WorkflowExecution_Status.SUCCESS,
          jobs: [{ executionId: "fn-1", status: succeeded }],
        },
      ],
      { "fn-1": [[], [MIGRATION_SCRIPT_STARTED_LOG, "INFO backfilled 3 rows"]] },
    );

    const { result, events } = runObserved(client);

    expect(await result).toMatchObject({ success: true, logs: "INFO backfilled 3 rows" });
    expect(events).toEqual(["waiting", "running", "finished:true"]);
  });

  test("goes back to waiting while no job runs the script", async () => {
    const { client } = observedClient(
      [
        {
          status: WorkflowExecution_Status.RUNNING,
          jobs: [{ executionId: "fn-1", status: running }],
        },
        {
          status: WorkflowExecution_Status.RUNNING,
          jobs: [
            { executionId: "fn-1", status: succeeded },
            { executionId: "fn-2", status: running },
          ],
        },
        {
          status: WorkflowExecution_Status.RUNNING,
          jobs: [
            { executionId: "fn-1", status: succeeded },
            { executionId: "fn-2", status: running },
          ],
        },
        {
          status: WorkflowExecution_Status.SUCCESS,
          jobs: [
            { executionId: "fn-1", status: succeeded },
            { executionId: "fn-2", status: succeeded },
          ],
        },
      ],
      {
        "fn-1": [[MIGRATION_SCRIPT_STARTED_LOG]],
        "fn-2": [[], [MIGRATION_SCRIPT_STARTED_LOG]],
      },
    );

    const { result, events } = runObserved(client);

    await result;
    expect(events).toEqual(["waiting", "running", "waiting", "running", "finished:true"]);
  });

  test("reads a job's logs only until it is seen running the script", async () => {
    const { client, raw } = observedClient(
      [
        {
          status: WorkflowExecution_Status.RUNNING,
          jobs: [{ executionId: "fn-1", status: running }],
        },
        {
          status: WorkflowExecution_Status.RUNNING,
          jobs: [{ executionId: "fn-1", status: running }],
        },
        {
          status: WorkflowExecution_Status.RUNNING,
          jobs: [{ executionId: "fn-1", status: running }],
        },
        {
          status: WorkflowExecution_Status.SUCCESS,
          jobs: [{ executionId: "fn-1", status: succeeded }],
        },
      ],
      { "fn-1": [[MIGRATION_SCRIPT_STARTED_LOG]] },
    );

    await runObserved(client).result;

    // One read while polling, one for the final logs.
    expect(raw.getFunctionExecution).toHaveBeenCalledTimes(2);
  });

  test("notices a script that ran between two polls", async () => {
    const { client } = observedClient(
      [
        {
          status: WorkflowExecution_Status.SUCCESS,
          jobs: [{ executionId: "fn-1", status: succeeded }],
        },
      ],
      { "fn-1": [[MIGRATION_SCRIPT_STARTED_LOG, "INFO done"]] },
    );

    const { result, events } = runObserved(client);

    expect(await result).toMatchObject({ success: true, logs: "INFO done" });
    expect(events).toEqual(["waiting", "finished:true"]);
  });

  test("rereads the logs of a finished run whose start has not arrived yet", async () => {
    const { client } = observedClient(
      [
        {
          status: WorkflowExecution_Status.SUCCESS,
          jobs: [{ executionId: "fn-1", status: succeeded }],
        },
      ],
      { "fn-1": [["INFO done"], [MIGRATION_SCRIPT_STARTED_LOG, "INFO done"]] },
    );

    const { result, events } = runObserved(client);

    expect(await result).toMatchObject({ success: true, logs: "INFO done" });
    expect(events).toEqual(["waiting", "finished:true"]);
  });

  test("reports a finished run whose script was never seen starting", async () => {
    const { client } = observedClient(
      [
        {
          status: WorkflowExecution_Status.SUCCESS,
          jobs: [{ executionId: "fn-1", status: succeeded }],
        },
      ],
      { "fn-1": [["INFO done"]] },
    );

    const { result, events } = runObserved(client);

    expect(await result).toMatchObject({ success: true, logs: "INFO done" });
    expect(events).toEqual(["waiting", "finished:false"]);
  });

  test("keeps polling when a job's logs cannot be read", async () => {
    const { client, raw } = observedClient(
      [
        {
          status: WorkflowExecution_Status.RUNNING,
          jobs: [{ executionId: "fn-1", status: running }],
        },
        {
          status: WorkflowExecution_Status.RUNNING,
          jobs: [{ executionId: "fn-1", status: running }],
        },
        {
          status: WorkflowExecution_Status.SUCCESS,
          jobs: [{ executionId: "fn-1", status: succeeded }],
        },
      ],
      { "fn-1": [[MIGRATION_SCRIPT_STARTED_LOG]] },
    );
    raw.getFunctionExecution.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable),
    );

    const { result, events } = runObserved(client);

    expect(await result).toMatchObject({ success: true });
    expect(events).toEqual(["waiting", "running", "finished:true"]);
  });
});
