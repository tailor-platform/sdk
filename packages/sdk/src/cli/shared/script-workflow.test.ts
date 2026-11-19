// oxlint-disable local/typed-operator-client-mock -- Untyped mocks; migrate them to mockOperatorClient() when editing them.
import { Code, ConnectError } from "@connectrpc/connect";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { describe, expect, test, vi } from "vitest";
import { logger } from "./logger";
import {
  assertNoActiveScriptWorkflow,
  liveMainJobExecutionId,
  mainJobExecutionId,
  outcomeJobExecutionId,
  readOutcome,
  withScriptWorkflow,
} from "./script-workflow";
import type { OperatorClient } from "./client";
import type { ScriptInvoker } from "./script-executor";
import type { WorkflowExecution } from "@tailor-platform/tailor-proto/workflow_resource_pb";

vi.mock(import("#/cli/shared/logger"), async (importOriginal) => {
  const actual = await importOriginal();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), log: vi.fn() };
  return { ...actual, logger: logger as unknown as typeof actual.logger };
});

vi.mock("#/cli/commands/deploy/label", async (importOriginal) => ({
  ...(await importOriginal()),
  resourceTrn: (workspaceId: string, kind: string, name: string) =>
    `trn:v1:workspace:${workspaceId}:${kind}:${name}`,
  writeMetadataLabelsDirect: vi.fn(),
  buildMetaRequest: vi.fn(async (params: unknown) => params),
}));

const invoker = { namespace: "auth", machineUserName: "seeder" } as ScriptInvoker;

interface MockClientOptions {
  status?: WorkflowExecution_Status;
  logs?: string[];
  result?: string;
  errorMessage?: string;
  /** Workflow left behind by an interrupted earlier run. */
  leftoverWorkflowId?: string;
  /** Executions of the leftover workflow, newest first. */
  leftoverExecutions?: { id: string; status: WorkflowExecution_Status }[];
  /** Machine user lookup result: found (default), answered empty, or rejected as not found. */
  machineUser?: "found" | "empty" | "not-found";
}

function createMockClient(options: MockClientOptions = {}) {
  const calls: string[] = [];
  const record = <T>(name: string, value: T) => {
    calls.push(name);
    return Promise.resolve(value);
  };
  const client = {
    getAuthMachineUser: vi.fn(() => {
      calls.push("getAuthMachineUser");
      if (options.machineUser === "not-found") {
        return Promise.reject(new ConnectError("not found", Code.NotFound));
      }
      return Promise.resolve({ machineUser: options.machineUser === "empty" ? undefined : {} });
    }),
    getWorkflowByName: vi.fn(() => {
      calls.push("getWorkflowByName");
      if (options.leftoverWorkflowId === undefined) {
        return Promise.reject(new ConnectError("not found", Code.NotFound));
      }
      return Promise.resolve({ workflow: { id: options.leftoverWorkflowId } });
    }),
    listWorkflowExecutions: vi.fn(() => {
      calls.push("listWorkflowExecutions");
      if (options.leftoverWorkflowId === undefined) {
        return Promise.reject(new ConnectError("not found", Code.NotFound));
      }
      return Promise.resolve({ executions: options.leftoverExecutions ?? [], nextPageToken: "" });
    }),
    deleteWorkflow: vi.fn(() => record("deleteWorkflow", {})),
    deleteWorkflowJobFunction: vi.fn(() => record("deleteWorkflowJobFunction", {})),
    deleteFunctionRegistry: vi.fn(() => record("deleteFunctionRegistry", {})),
    createFunctionRegistry: vi.fn(() => record("createFunctionRegistry", {})),
    createWorkflowJobFunction: vi.fn(() =>
      record("createWorkflowJobFunction", { jobFunction: { version: 1n } }),
    ),
    createWorkflow: vi.fn(() => record("createWorkflow", { workflow: { id: "wf-1" } })),
    startWorkflow: vi.fn((_request: { workflowId: string; authInvoker: unknown; arg: string }) =>
      record("startWorkflow", { executionId: "exec-1" }),
    ),
    getWorkflowExecution: vi.fn(() =>
      Promise.resolve({
        execution: {
          status: options.status ?? WorkflowExecution_Status.SUCCESS,
          jobExecutions: [
            {
              executionId: "fn-1",
              kind: { case: "jobFunction", value: { name: "job" } },
              position: { depth: 0, parentWorkflowJobExecutionId: "" },
            },
          ],
        },
      }),
    ),
    getFunctionExecution: vi.fn(() =>
      Promise.resolve({
        execution: {
          logEntries: (options.logs ?? []).map((message) => ({ message })),
          error: options.errorMessage ? { message: options.errorMessage } : undefined,
          result: options.result ?? "",
        },
      }),
    ),
  };
  return { client: client as unknown as OperatorClient, mocks: client, calls };
}

const baseOptions = {
  workspaceId: "ws",
  name: "tailordb-seed--tailordb",
  description: "Temporary function for seeding",
  code: "export async function main() {}",
  invoker,
  appName: "my-app",
  leftoverNote: "It is removed by the next run.",
  pollIntervalMs: 1,
};

describe("withScriptWorkflow", () => {
  test("registers the script once and starts it once per argument with the argument as JSON", async () => {
    const { client, mocks } = createMockClient({ result: '{"success":true}' });

    await withScriptWorkflow({ ...baseOptions, client }, async (run) => {
      await run({ chunk: 1 });
      await run({ chunk: 2 });
    });

    expect(mocks.createFunctionRegistry).toHaveBeenCalledTimes(1);
    expect(mocks.createWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.startWorkflow.mock.calls.map(([request]) => request.arg)).toEqual([
      '{"chunk":1}',
      '{"chunk":2}',
    ]);
    expect(mocks.startWorkflow.mock.calls[0]?.[0]).toMatchObject({
      workflowId: "wf-1",
      authInvoker: invoker,
    });
  });

  test("returns the logs and result of the job when the workflow succeeds", async () => {
    const { client } = createMockClient({
      logs: ["[tailordb] User: 1/1"],
      result: '{"success":true,"processed":{}}',
    });

    const outcome = await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(outcome).toEqual({
      success: true,
      logs: "[tailordb] User: 1/1",
      result: '{"success":true,"processed":{}}',
    });
  });

  test("reports the job's error message when the workflow fails", async () => {
    const { client } = createMockClient({
      status: WorkflowExecution_Status.FAILED,
      errorMessage: "Query cancelled due to runtime timeout",
    });

    const outcome = await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(outcome).toMatchObject({
      success: false,
      error: "Query cancelled due to runtime timeout",
    });
  });

  test("removes the workflow, job function and function after the callback", async () => {
    const { client, calls } = createMockClient();

    await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(calls.slice(-3)).toEqual([
      "deleteWorkflow",
      "deleteWorkflowJobFunction",
      "deleteFunctionRegistry",
    ]);
  });

  test("removes the resources and rethrows when the callback throws", async () => {
    const { client, mocks, calls } = createMockClient();

    await expect(
      withScriptWorkflow({ ...baseOptions, client }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(mocks.deleteWorkflow).toHaveBeenCalledWith({ workspaceId: "ws", workflowId: "wf-1" });
    expect(calls.at(-1)).toBe("deleteFunctionRegistry");
  });

  test.each(["empty", "not-found"] as const)(
    "stops before registering anything when the machine user lookup is %s",
    async (machineUser) => {
      const { client, mocks } = createMockClient({ machineUser });

      const run = withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

      await expect(run).rejects.toMatchObject({
        code: "MACHINE_USER_NOT_FOUND",
        message: expect.stringContaining("seeder"),
      });
      expect(mocks.createFunctionRegistry).not.toHaveBeenCalled();
      expect(mocks.startWorkflow).not.toHaveBeenCalled();
    },
  );

  test("looks the machine user up in the invoker's auth namespace", async () => {
    const { client, mocks } = createMockClient();

    await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(mocks.getAuthMachineUser).toHaveBeenCalledWith({
      workspaceId: "ws",
      authNamespace: "auth",
      name: "seeder",
    });
  });

  test("rethrows an error of the machine user lookup other than not found", async () => {
    const { client, mocks } = createMockClient();
    mocks.getAuthMachineUser.mockRejectedValue(new ConnectError("denied", Code.PermissionDenied));

    const run = withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    await expect(run).rejects.toThrow("denied");
  });

  test.each([
    [WorkflowExecution_Status.SUCCESS, "unknown whether the script's changes were applied"],
    [WorkflowExecution_Status.FAILED, "Script execution failed with unknown error"],
  ])(
    "reports the outcome of a %s workflow whose job execution the platform has no record of",
    async (status, error) => {
      const { client, mocks } = createMockClient({ status });
      mocks.getFunctionExecution.mockRejectedValue(new ConnectError("not found", Code.NotFound));

      const outcome = await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

      expect(outcome).toMatchObject({ success: false, error: expect.stringContaining(error) });
      expect(mocks.getFunctionExecution).toHaveBeenCalledTimes(1);
    },
  );

  test("reads the job's outcome again after a transient error", async () => {
    const { client, mocks } = createMockClient({ result: '{"success":true}' });
    mocks.getFunctionExecution
      .mockRejectedValueOnce(new ConnectError("unavailable", Code.Unavailable))
      .mockImplementation(() =>
        Promise.resolve({
          execution: { logEntries: [], error: undefined, result: '{"success":true}' },
        }),
      );

    const outcome = await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(outcome).toMatchObject({ success: true, result: '{"success":true}' });
    expect(mocks.getFunctionExecution).toHaveBeenCalledTimes(2);
  });

  test("reports an unknown outcome when a finished workflow's job result cannot be found", async () => {
    const { client, mocks } = createMockClient();
    mocks.getFunctionExecution.mockResolvedValue({ execution: undefined } as never);

    const outcome = await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(outcome).toMatchObject({
      success: false,
      error: expect.stringContaining("unknown whether the script's changes were applied"),
    });
  });

  test("tells how a resource that could not be removed gets removed", async () => {
    const { client, mocks } = createMockClient();
    mocks.deleteWorkflow.mockRejectedValue(new ConnectError("unavailable", Code.Unavailable));

    await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(vi.mocked(logger.warn).mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining("It is removed by the next run."),
    ]);
  });

  test("stops without removing anything when an earlier run of the workflow is still executing", async () => {
    const { client, mocks } = createMockClient({
      leftoverWorkflowId: "wf-old",
      leftoverExecutions: [{ id: "exec-old", status: WorkflowExecution_Status.RUNNING }],
    });

    const run = withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    await expect(run).rejects.toMatchObject({
      code: "SCRIPT_WORKFLOW_EXECUTION_ACTIVE",
      context: { workflowName: "tailordb-seed--tailordb", executionId: "exec-old" },
    });
    expect(mocks.deleteWorkflow).not.toHaveBeenCalled();
    expect(mocks.deleteFunctionRegistry).not.toHaveBeenCalled();
    expect(mocks.createFunctionRegistry).not.toHaveBeenCalled();
  });

  test("reclaims the leftovers of an earlier run that has finished", async () => {
    const { client, mocks } = createMockClient({
      leftoverWorkflowId: "wf-old",
      leftoverExecutions: [{ id: "exec-old", status: WorkflowExecution_Status.FAILED }],
    });

    await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(mocks.deleteWorkflow).toHaveBeenCalledWith({ workspaceId: "ws", workflowId: "wf-old" });
  });

  test("reclaims the leftovers of an interrupted run before registering the script", async () => {
    const { client, calls } = createMockClient({ leftoverWorkflowId: "wf-old" });

    await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(calls.indexOf("deleteWorkflow")).toBeLessThan(calls.indexOf("createFunctionRegistry"));
  });
});

describe("assertNoActiveScriptWorkflow", () => {
  const running = [{ id: "exec-old", status: WorkflowExecution_Status.RUNNING }];

  test("names the workspace and profile in the command that inspects the running execution", async () => {
    const { client } = createMockClient({
      leftoverWorkflowId: "wf-old",
      leftoverExecutions: running,
    });

    const check = assertNoActiveScriptWorkflow({
      client,
      workspaceId: "ws",
      names: ["tailordb-seed--tailordb"],
      profile: "staging",
    });

    await expect(check).rejects.toMatchObject({
      suggestion: expect.stringContaining(
        "tailor workflow executions exec-old --workspace-id=ws --profile=staging",
      ),
    });
  });

  test("passes when none of the workflows exists", async () => {
    const { client } = createMockClient();

    await expect(
      assertNoActiveScriptWorkflow({ client, workspaceId: "ws", names: ["a", "b"] }),
    ).resolves.toBeUndefined();
  });

  test("passes when the workflow's executions have all finished", async () => {
    const { client } = createMockClient({
      leftoverWorkflowId: "wf-old",
      leftoverExecutions: [{ id: "exec-old", status: WorkflowExecution_Status.SUCCESS }],
    });

    await expect(
      assertNoActiveScriptWorkflow({ client, workspaceId: "ws", names: ["a"] }),
    ).resolves.toBeUndefined();
  });
});

describe("the main job of a workflow execution", () => {
  const row = (
    executionId: string,
    depth: number,
    kind: "jobFunction" | "wait" = "jobFunction",
  ) => ({
    executionId,
    kind: { case: kind, value: { name: "job" } },
    position: { depth, parentWorkflowJobExecutionId: depth === 0 ? "" : "job-main" },
  });
  const executionOf = (...rows: ReturnType<typeof row>[]) =>
    ({
      status: WorkflowExecution_Status.SUCCESS,
      jobExecutions: rows,
    }) as unknown as WorkflowExecution;

  test("is the job at depth 0 even when the jobs it started are listed after it", () => {
    expect(mainJobExecutionId(executionOf(row("fn-main", 0), row("fn-child", 1)))).toBe("fn-main");
  });

  test("is the job at depth 0 even when the jobs it started are listed before it", () => {
    expect(mainJobExecutionId(executionOf(row("fn-child", 1), row("fn-main", 0)))).toBe("fn-main");
  });

  test("is the last row at depth 0 when the main job was recorded more than once", () => {
    expect(
      mainJobExecutionId(executionOf(row("fn-first", 0), row("fn-child", 1), row("fn-last", 0))),
    ).toBe("fn-last");
  });

  test("is never a wait checkpoint, which runs no function", () => {
    expect(mainJobExecutionId(executionOf(row("nil", 0, "wait"), row("fn-main", 0)))).toBe(
      "fn-main",
    );
  });

  test("is read for the result, not the job it started", async () => {
    const client = {
      getFunctionExecution: vi.fn(async (request: { executionId: string }) => ({
        execution: {
          logEntries: [],
          result: request.executionId === "fn-main" ? '"main"' : '"child"',
        },
      })),
    };

    const outcome = await readOutcome({
      client: client as unknown as OperatorClient,
      workspaceId: "ws",
      execution: executionOf(row("fn-main", 0), row("fn-child", 1)),
      pollInterval: 1,
    });

    expect(outcome).toEqual({
      success: true,
      logs: "",
      result: '"main"',
      jobFunctionName: "job",
    });
  });
});

describe("the job a finished run's outcome is read from", () => {
  const job = (executionId: string, depth: number, status: WorkflowJobExecution_Status) => ({
    executionId,
    status,
    kind: { case: "jobFunction", value: { name: "job" } },
    position: { depth, parentWorkflowJobExecutionId: depth === 0 ? "" : "job-main" },
  });
  const failedRun = (...rows: ReturnType<typeof job>[]) =>
    ({
      status: WorkflowExecution_Status.FAILED,
      jobExecutions: rows,
    }) as unknown as WorkflowExecution;
  const { FAILED, SUCCESS } = WorkflowJobExecution_Status;

  test("is the deepest job that failed, since the main job only reports that a job it started did not return", () => {
    expect(
      outcomeJobExecutionId(failedRun(job("fn-main", 0, FAILED), job("fn-child", 1, FAILED))),
    ).toBe("fn-child");
  });

  test("is the main job when it failed on its own and the jobs it started succeeded", () => {
    expect(
      outcomeJobExecutionId(failedRun(job("fn-main", 0, FAILED), job("fn-child", 1, SUCCESS))),
    ).toBe("fn-main");
  });

  test("is the main job of a run that succeeded", () => {
    const run = {
      status: WorkflowExecution_Status.SUCCESS,
      jobExecutions: [job("fn-main", 0, SUCCESS), job("fn-child", 1, FAILED)],
    } as unknown as WorkflowExecution;

    expect(outcomeJobExecutionId(run)).toBe("fn-main");
  });

  describe("for a run that started other jobs", () => {
    const named = (
      executionId: string,
      depth: number,
      status: WorkflowJobExecution_Status,
      name: string,
    ) => ({
      ...job(executionId, depth, status),
      kind: { case: "jobFunction", value: { name } },
    });
    const logsOf = (logs: Record<string, string>) => ({
      getFunctionExecution: vi.fn(async (request: { executionId: string }) => ({
        execution: {
          logEntries: logs[request.executionId] ? [{ message: logs[request.executionId] }] : [],
          result: request.executionId === "fn-main" ? '"main"' : '"child"',
        },
      })),
    });
    const succeeded = {
      status: WorkflowExecution_Status.SUCCESS,
      jobExecutions: [
        named("fn-main", 0, SUCCESS, "run-main"),
        named("fn-child", 1, SUCCESS, "run-child"),
      ],
    } as unknown as WorkflowExecution;

    test("reports the logs of every job, each line marked with its job", async () => {
      const client = logsOf({ "fn-main": "main line 1\nmain line 2", "fn-child": "child line" });

      const outcome = await readOutcome({
        client: client as unknown as OperatorClient,
        workspaceId: "ws",
        execution: succeeded,
        pollInterval: 1,
        jobLabel: (name) => name.replace("run-", ""),
      });

      expect(outcome.logs).toBe("[main] main line 1\n[main] main line 2\n[child] child line");
      expect(outcome.result).toBe('"main"');
    });

    test("reports the logs of the parent too when a child failed, and the error of the child", async () => {
      const failed = {
        status: WorkflowExecution_Status.FAILED,
        jobExecutions: [
          named("fn-main", 0, FAILED, "run-main"),
          named("fn-child", 1, FAILED, "run-child"),
        ],
      } as unknown as WorkflowExecution;
      const client = {
        getFunctionExecution: vi.fn(async (request: { executionId: string }) => ({
          execution:
            request.executionId === "fn-child"
              ? { logEntries: [{ message: "child log" }], result: "", error: { message: "boom" } }
              : { logEntries: [{ message: "parent log" }], result: "" },
        })),
      };

      const outcome = await readOutcome({
        client: client as unknown as OperatorClient,
        workspaceId: "ws",
        execution: failed,
        pollInterval: 1,
      });

      expect(outcome.logs).toBe("[run-main] parent log\n[run-child] child log");
      expect(outcome).toMatchObject({ success: false, error: "boom" });
    });

    test("still reports the outcome when the log of another job cannot be read", async () => {
      const client = {
        getFunctionExecution: vi.fn(async (request: { executionId: string }) => {
          if (request.executionId === "fn-child") throw new Error("lookup failed");
          return { execution: { logEntries: [{ message: "main line" }], result: '"main"' } };
        }),
      };

      const outcome = await readOutcome({
        client: client as unknown as OperatorClient,
        workspaceId: "ws",
        execution: succeeded,
        pollInterval: 1,
        jobLabel: (name) => name.replace("run-", ""),
      });

      expect(outcome).toEqual({
        success: true,
        logs: "[main] main line",
        result: '"main"',
        jobFunctionName: "run-main",
      });
    });

    test("reads the logs of the jobs it started at the same time", async () => {
      let inFlight = 0;
      let peak = 0;
      const client = {
        getFunctionExecution: vi.fn(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 20));
          inFlight -= 1;
          return { execution: { logEntries: [{ message: "x" }], result: '"r"' } };
        }),
      };
      const manyJobs = {
        status: WorkflowExecution_Status.SUCCESS,
        jobExecutions: [
          named("fn-main", 0, SUCCESS, "run-main"),
          named("fn-a", 1, SUCCESS, "run-a"),
          named("fn-b", 1, SUCCESS, "run-b"),
          named("fn-c", 1, SUCCESS, "run-c"),
        ],
      } as unknown as WorkflowExecution;

      await readOutcome({
        client: client as unknown as OperatorClient,
        workspaceId: "ws",
        execution: manyJobs,
        pollInterval: 1,
      });

      expect(peak).toBe(3);
    });

    test("names the job function the outcome was read from", async () => {
      const outcome = await readOutcome({
        client: logsOf({}) as unknown as OperatorClient,
        workspaceId: "ws",
        execution: succeeded,
        pollInterval: 1,
      });

      expect(outcome.jobFunctionName).toBe("run-main");
    });
  });

  describe("for a run that was canceled while its main job waited for a job it started", () => {
    const { CANCELED } = WorkflowJobExecution_Status;
    const canceledRun = (...rows: ReturnType<typeof job>[]) =>
      ({
        status: WorkflowExecution_Status.CANCELED,
        jobExecutions: rows,
      }) as unknown as WorkflowExecution;
    const callRecord = '{"arg":{},"arg_hash":"abc","call_index":0,"job_name":"child"}';

    test("is the job that was canceled, not the main job that only holds the record of its call", () => {
      expect(
        outcomeJobExecutionId(
          canceledRun(job("fn-main", 0, SUCCESS), job("fn-child", 1, CANCELED)),
        ),
      ).toBe("fn-child");
    });

    test("reports a cancellation, not the record of the suspended call, as the error", async () => {
      const client = {
        getFunctionExecution: vi.fn(async () => ({
          execution: { logEntries: [], result: callRecord },
        })),
      };

      const outcome = await readOutcome({
        client: client as unknown as OperatorClient,
        workspaceId: "ws",
        execution: canceledRun(job("fn-main", 0, CANCELED)),
        pollInterval: 1,
      });

      expect(outcome).toMatchObject({ success: false, error: "Script execution was canceled" });
    });
  });

  test("gives the error of the job that failed, not the main job's bookkeeping, when read", async () => {
    const client = {
      getFunctionExecution: vi.fn(async (request: { executionId: string }) => ({
        execution:
          request.executionId === "fn-child"
            ? { logEntries: [], result: "", error: { message: "boom-from-child" } }
            : { logEntries: [], result: '{"call_index":0,"job_name":"child"}' },
      })),
    };

    const outcome = await readOutcome({
      client: client as unknown as OperatorClient,
      workspaceId: "ws",
      execution: failedRun(job("fn-main", 0, FAILED), job("fn-child", 1, FAILED)),
      pollInterval: 1,
    });

    expect(outcome).toMatchObject({ success: false, error: "boom-from-child" });
  });
});

describe("the main job of a run that is going", () => {
  const row = (executionId: string, depth: number, status: WorkflowJobExecution_Status) => ({
    executionId,
    status,
    kind: { case: "jobFunction", value: { name: "job" } },
    position: { depth, parentWorkflowJobExecutionId: depth === 0 ? "" : "job-main" },
  });
  const running = (...rows: ReturnType<typeof row>[]) =>
    ({
      status: WorkflowExecution_Status.RUNNING,
      jobExecutions: rows,
    }) as unknown as WorkflowExecution;
  const { RUNNING, SUSPEND, WAITING } = WorkflowJobExecution_Status;

  test("has no execution id while it is suspended waiting for a job it started, which holds only a record of the call", () => {
    expect(
      liveMainJobExecutionId(running(row("fn-first", 0, SUSPEND), row("fn-child", 1, RUNNING))),
    ).toBe(undefined);
  });

  test("has no execution id while it waits at a wait point", () => {
    expect(liveMainJobExecutionId(running(row("fn-first", 0, WAITING)))).toBe(undefined);
  });

  test("is the execution it was run again as, once the job it waited for has finished", () => {
    expect(
      liveMainJobExecutionId(running(row("fn-again", 0, RUNNING), row("fn-child", 1, RUNNING))),
    ).toBe("fn-again");
  });
});
