import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { FunctionExecution_Status } from "@tailor-platform/tailor-proto/function_resource_pb";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { writeMetadataLabelsDirect } from "#/cli/commands/deploy/label";
import { logger } from "./logger";
import { createConcurrencyProbe } from "./test-helpers/concurrency-probe";
import { mockOperatorClient } from "./test-helpers/operator-client";
import {
  assertPollInterval,
  assertWaitTimeout,
  assertWorkflowArg,
  awaitWorkflowRun,
  reclaimFinishedWorkflowRuns,
  reclaimWorkflowRuns,
  startWorkflowRun,
  pruneHint,
  workflowRunHints,
} from "./workflow-run";
import { createRunId, workflowRunJobFunctionName, workflowRunLabels } from "./workflow-run-labels";
import type { ScriptInvoker } from "./script-executor";

vi.mock(import("#/cli/shared/logger"), async (importOriginal) => {
  const actual = await importOriginal();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), log: vi.fn() };
  return { ...actual, logger: logger as unknown as typeof actual.logger };
});

vi.mock("#/cli/commands/deploy/label", () => ({
  resourceTrn: (workspaceId: string, kind: string, name: string) =>
    `trn:v1:workspace:${workspaceId}:${kind}:${name}`,
  sdkNameLabelKey: "sdk-name",
  sdkAppIdLabelKey: "sdk-app-id",
  writeMetadataLabelsDirect: vi.fn(),
  buildMetaRequest: vi.fn(async (params: unknown) => params),
}));

beforeEach(() => {
  vi.mocked(writeMetadataLabelsDirect).mockClear();
});

const invoker = { namespace: "auth", machineUserName: "runner" } as ScriptInvoker;
const now = new Date("2026-11-18T13:00:00Z");
const runId = createRunId(now, "aaaaaa");

interface ClientOptions {
  status?: WorkflowExecution_Status;
  result?: string;
}

function createClient(options: ClientOptions = {}) {
  return mockOperatorClient({
    getAuthMachineUser: async () => ({ machineUser: {} }),
    createFunctionRegistry: async () => ({}),
    createWorkflowJobFunction: async () => ({ jobFunction: { version: 1n } }),
    createWorkflow: async () => ({ workflow: { id: "wf-1" } }),
    startWorkflow: async () => ({ executionId: "exec-1" }),
    getWorkflowExecution: async () => ({
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
    getFunctionExecution: async () => ({
      execution: { logEntries: [{ message: "hello" }], result: options.result ?? '{"ok":true}' },
    }),
    deleteWorkflow: async () => ({}),
    deleteWorkflowJobFunction: async () => ({}),
    deleteFunctionRegistry: async () => ({}),
  });
}

describe("startWorkflowRun", () => {
  test("registers the main job under the run's name and starts it with the argument", async () => {
    const client = createClient();
    const started = await startWorkflowRun({
      client,
      workspaceId: "ws",
      runId,
      mainJobName: "main",
      jobs: [{ jobName: "main", code: "export async function main() {}" }],
      description: "workflow run",
      invoker,
      arg: { n: 1 },
    });

    expect(started).toEqual({
      runId,
      name: `tmp-run-${runId}`,
      functionNames: [`tmp-run-${runId}-main`],
      jobNames: { [`tmp-run-${runId}-main`]: "main" },
      workflowId: "wf-1",
      executionId: "exec-1",
    });
    expect(client.startWorkflow.mock.calls[0]?.[0].arg).toBe('{"n":1}');
  });

  test("labels the function, job function and workflow with the run key and no owner", async () => {
    const client = createClient();
    await startWorkflowRun({
      client,
      workspaceId: "ws",
      runId,
      mainJobName: "main",
      jobs: [{ jobName: "main", code: "" }],
      description: "d",
      invoker,
      arg: undefined,
    });

    const writes = vi.mocked(writeMetadataLabelsDirect).mock.calls.map(([, write]) => write);
    expect(writes.map((write) => write.trn.split(":").at(-2))).toEqual([
      "function_registry",
      "workflow_job_function",
      "workflow",
    ]);
    for (const write of writes) {
      expect(write.labels).toEqual(workflowRunLabels({ runId }));
    }
  });

  describe("for a workflow job and the jobs it starts", () => {
    const jobRun = (client: ReturnType<typeof createClient>) =>
      startWorkflowRun({
        client,
        workspaceId: "ws",
        runId,
        mainJobName: "process-order",
        jobs: [
          { jobName: "process-order", code: "// parent" },
          { jobName: "validate-order", code: "// child" },
        ],
        description: "d",
        invoker,
        arg: { id: "1" },
      });

    test("registers one function and job function per job under names no deployed job has", async () => {
      const client = createClient();
      await jobRun(client);

      expect(client.createWorkflowJobFunction.mock.calls.map(([request]) => request)).toEqual([
        expect.objectContaining({
          jobFunctionName: `tmp-run-${runId}-process-order`,
          scriptRef: `tmp-run-${runId}-process-order`,
        }),
        expect.objectContaining({
          jobFunctionName: `tmp-run-${runId}-validate-order`,
          scriptRef: `tmp-run-${runId}-validate-order`,
        }),
      ]);
      expect(client.createFunctionRegistry).toHaveBeenCalledTimes(2);
    });

    test("makes the selected job the main job of the workflow and lists every job in it", async () => {
      const client = createClient();
      await jobRun(client);

      expect(client.createWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowName: `tmp-run-${runId}`,
          mainJobFunctionName: `tmp-run-${runId}-process-order`,
          jobFunctions: {
            [`tmp-run-${runId}-process-order`]: 1n,
            [`tmp-run-${runId}-validate-order`]: 1n,
          },
        }),
      );
    });

    test("labels every resource with the job key and no owner", async () => {
      const client = createClient();
      await jobRun(client);

      const writes = vi.mocked(writeMetadataLabelsDirect).mock.calls.map(([, write]) => write);
      expect(writes).toHaveLength(5);
      for (const write of writes) {
        expect(write.labels).toEqual(workflowRunLabels({ runId }));
      }
    });

    test("removes every function and job function it registered when the start is refused", async () => {
      const client = createClient();
      client.startWorkflow.mockRejectedValueOnce(new ConnectError("denied", Code.PermissionDenied));

      await expect(jobRun(client)).rejects.toThrow("denied");

      expect(client.deleteWorkflowJobFunction).toHaveBeenCalledTimes(2);
      expect(client.deleteFunctionRegistry).toHaveBeenCalledTimes(2);
    });

    test("waits for a run without a time limit when the wait is unlimited", async () => {
      const client = createClient();
      const started = await jobRun(client);

      const outcome = await awaitWorkflowRun({
        client,
        workspaceId: "ws",
        started,
        pollInterval: 1,
        timeoutMs: Number.POSITIVE_INFINITY,
      });

      expect(outcome.state).toBe("finished");
    });

    test("removes all of them once the run finishes", async () => {
      const client = createClient();
      const started = await jobRun(client);

      await awaitWorkflowRun({
        client,
        workspaceId: "ws",
        started,
        pollInterval: 1,
        timeoutMs: 1000,
      });

      expect(client.deleteWorkflowJobFunction).toHaveBeenCalledTimes(2);
      expect(client.deleteFunctionRegistry).toHaveBeenCalledTimes(2);
    });
  });

  test("removes what it registered when the start is refused", async () => {
    const client = createClient();
    client.startWorkflow.mockRejectedValueOnce(new ConnectError("denied", Code.PermissionDenied));

    await expect(
      startWorkflowRun({
        client,
        workspaceId: "ws",
        runId,
        mainJobName: "main",
        jobs: [{ jobName: "main", code: "" }],
        description: "d",
        invoker,
        arg: undefined,
      }),
    ).rejects.toThrow("denied");
    expect(client.deleteWorkflow).toHaveBeenCalledOnce();
    expect(client.deleteFunctionRegistry).toHaveBeenCalledOnce();
  });
});

describe("startWorkflowRun when the start outcome is unknown", () => {
  test("keeps the resources, since an execution may have been created", async () => {
    const client = createClient();
    client.startWorkflow.mockRejectedValueOnce(new ConnectError("reset", Code.Unavailable));

    await expect(
      startWorkflowRun({
        client,
        workspaceId: "ws",
        runId,
        mainJobName: "main",
        jobs: [{ jobName: "main", code: "" }],
        description: "d",
        invoker,
        arg: undefined,
      }),
    ).rejects.toThrow("reset");
    expect(client.deleteWorkflow).not.toHaveBeenCalled();
    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });
});

describe("startWorkflowRun with a machine user that does not exist", () => {
  test("fails before anything is registered, naming the machine user", async () => {
    const client = createClient();
    client.getAuthMachineUser.mockRejectedValueOnce(new ConnectError("nope", Code.NotFound));

    await expect(
      startWorkflowRun({
        client,
        workspaceId: "ws",
        runId,
        mainJobName: "main",
        jobs: [{ jobName: "main", code: "" }],
        description: "d",
        invoker,
        arg: undefined,
      }),
    ).rejects.toThrow(/runner/);
    expect(client.createFunctionRegistry).not.toHaveBeenCalled();
    expect(client.startWorkflow).not.toHaveBeenCalled();
  });
});

describe("startWorkflowRun when a later name is already taken", () => {
  const jobRun = (client: ReturnType<typeof createClient>) =>
    startWorkflowRun({
      client,
      workspaceId: "ws",
      runId,
      mainJobName: "process-order",
      jobs: [
        { jobName: "process-order", code: "// parent" },
        { jobName: "validate-order", code: "// child" },
      ],
      description: "d",
      invoker,
      arg: undefined,
    });
  const parent = workflowRunJobFunctionName(runId, "process-order");
  const child = workflowRunJobFunctionName(runId, "validate-order");

  test("removes the function it registered but not the one that already existed", async () => {
    const client = createClient();
    client.createFunctionRegistry
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new ConnectError("exists", Code.AlreadyExists));

    await expect(jobRun(client)).rejects.toThrow("exists");

    expect(client.deleteFunctionRegistry.mock.calls).toEqual([
      [{ workspaceId: "ws", name: parent }],
    ]);
    expect(client.deleteWorkflowJobFunction).not.toHaveBeenCalled();
    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("removes the job function it created but not the one that already existed", async () => {
    const client = createClient();
    client.createWorkflowJobFunction
      .mockResolvedValueOnce({ jobFunction: { version: 1n } })
      .mockRejectedValueOnce(new ConnectError("exists", Code.AlreadyExists));

    await expect(jobRun(client)).rejects.toThrow("exists");

    expect(client.deleteWorkflowJobFunction.mock.calls).toEqual([
      [{ workspaceId: "ws", jobFunctionName: parent }],
    ]);
    expect(
      client.deleteFunctionRegistry.mock.calls.map(([request]) => request.name).toSorted(),
    ).toEqual([child, parent].toSorted());
  });
});

describe("startWorkflowRun with two jobs that get the same name", () => {
  test("refuses the run before registering anything, naming both jobs", async () => {
    const longName = "send-the-quarterly-compliance-report-to-every-region";
    const shortened = workflowRunJobFunctionName(runId, longName).slice(`tmp-run-${runId}-`.length);
    const client = createClient();

    await expect(
      startWorkflowRun({
        client,
        workspaceId: "ws",
        runId,
        mainJobName: longName,
        jobs: [
          { jobName: longName, code: "" },
          { jobName: shortened, code: "" },
        ],
        description: "d",
        invoker,
        arg: undefined,
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_RUN_JOB_NAME_COLLISION",
      message: expect.stringContaining(shortened),
    });
    expect(client.createFunctionRegistry).not.toHaveBeenCalled();
  });
});

describe("startWorkflowRun when the run name is already taken", () => {
  test("removes nothing, because this invocation created nothing", async () => {
    const client = createClient();
    client.createFunctionRegistry.mockRejectedValueOnce(
      new ConnectError("exists", Code.AlreadyExists),
    );

    await expect(
      startWorkflowRun({
        client,
        workspaceId: "ws",
        runId,
        mainJobName: "main",
        jobs: [{ jobName: "main", code: "" }],
        description: "d",
        invoker,
        arg: undefined,
      }),
    ).rejects.toThrow("exists");
    expect(client.deleteWorkflow).not.toHaveBeenCalled();
    expect(client.deleteWorkflowJobFunction).not.toHaveBeenCalled();
    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });
});

const mainFunctionName = workflowRunJobFunctionName(runId, "main");
const started = {
  runId,
  name: `tmp-run-${runId}`,
  functionNames: [mainFunctionName],
  jobNames: { [mainFunctionName]: "main" },
  workflowId: "wf-1",
  executionId: "exec-1",
};

describe("awaitWorkflowRun", () => {
  test("reports the script's result and removes the resources once it finishes", async () => {
    const client = createClient();
    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome).toEqual({
      state: "finished",
      result: { success: true, logs: "hello", result: '{"ok":true}', jobFunctionName: "job" },
    });
    expect(client.deleteWorkflow).toHaveBeenCalledOnce();
    expect(client.deleteFunctionRegistry).toHaveBeenCalledOnce();
  });

  test("leaves the resources in place when the wait times out", async () => {
    const client = createClient({ status: WorkflowExecution_Status.RUNNING });
    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 5,
    });

    expect(outcome).toEqual({ state: "timedOut" });
    expect(client.deleteWorkflow).not.toHaveBeenCalled();
    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });
});

describe("awaitWorkflowRun when the result of a finished run cannot be read", () => {
  test("reports that the outcome is unavailable when the read never answers, and keeps the resources", async () => {
    const client = createClient();
    client.getFunctionExecution.mockImplementation(
      (_request, options) =>
        new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new ConnectError("canceled", Code.Canceled)),
          );
        }),
    );

    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 5,
      timeoutMs: 1000,
      outcomeTimeoutMs: 40,
    });

    expect(outcome.state).toBe("outcomeUnavailable");
    expect(client.deleteWorkflow).not.toHaveBeenCalled();
    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });

  test("reports it as unavailable, not as an error, when every read fails transiently", async () => {
    const client = createClient();
    client.getFunctionExecution.mockRejectedValue(new ConnectError("down", Code.Unavailable));

    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
      outcomeTimeoutMs: 1000,
    });

    expect(outcome.state).toBe("outcomeUnavailable");
    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });
});

describe("awaitWorkflowRun when a succeeded run has no readable job result", () => {
  test("keeps the resources and reports the outcome as unavailable, not as a failure", async () => {
    const client = createClient();
    client.getFunctionExecution.mockRejectedValue(new ConnectError("gone", Code.NotFound));

    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome.state).toBe("outcomeUnavailable");
    expect(client.deleteWorkflow).not.toHaveBeenCalled();
    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });

  test("does the same when the finished execution lists no job execution at all", async () => {
    const client = createClient();
    client.getWorkflowExecution.mockResolvedValue({
      execution: { status: WorkflowExecution_Status.SUCCESS, jobExecutions: [] },
    });

    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome.state).toBe("outcomeUnavailable");
    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("still treats a failed run as finished and removes its resources", async () => {
    const client = createClient({ status: WorkflowExecution_Status.FAILED });

    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome.state).toBe("finished");
    expect(client.deleteWorkflow).toHaveBeenCalledOnce();
  });
});

describe("awaitWorkflowRun when a sweep removes the workflow while it waits", () => {
  const running = {
    execution: {
      status: WorkflowExecution_Status.RUNNING,
      jobExecutions: [
        {
          executionId: "fn-1",
          kind: { case: "jobFunction" as const, value: { name: "job" } },
          position: { depth: 0, parentWorkflowJobExecutionId: "" },
        },
      ],
    },
  };
  const gone = new ConnectError("workflow not found", Code.NotFound);

  test("reads the result from the job's own execution, which outlives the workflow", async () => {
    const client = createClient();
    client.getWorkflowExecution.mockResolvedValueOnce(running).mockRejectedValue(gone);
    client.getFunctionExecution.mockResolvedValue({
      execution: {
        status: FunctionExecution_Status.SUCCESS,
        logEntries: [{ message: "hello" }],
        result: '{"ok":true}',
      },
    });

    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome).toEqual({
      state: "finished",
      result: { success: true, logs: "hello", result: '{"ok":true}' },
    });
  });

  test("follows the main job rather than a job it started when the workflow is removed", async () => {
    const client = createClient();
    client.getWorkflowExecution
      .mockResolvedValueOnce({
        execution: {
          status: WorkflowExecution_Status.RUNNING,
          jobExecutions: [
            {
              executionId: "fn-main",
              kind: { case: "jobFunction", value: { name: "job" } },
              position: { depth: 0, parentWorkflowJobExecutionId: "" },
            },
            {
              executionId: "fn-child",
              kind: { case: "jobFunction", value: { name: "job" } },
              position: { depth: 1, parentWorkflowJobExecutionId: "job-main" },
            },
          ],
        },
      })
      .mockRejectedValue(gone);
    client.getFunctionExecution.mockImplementation(async (request) => ({
      execution: {
        status: FunctionExecution_Status.SUCCESS,
        logEntries: [],
        result:
          (request as { executionId: string } | undefined)?.executionId === "fn-main"
            ? '"main"'
            : '"child"',
      },
    }));

    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome).toEqual({
      state: "finished",
      result: { success: true, logs: "", result: '"main"' },
    });
  });

  describe("when the main job was suspended waiting for a job it started", () => {
    const withMain = (status: WorkflowJobExecution_Status) => ({
      execution: {
        status: WorkflowExecution_Status.RUNNING,
        jobExecutions: [
          {
            executionId: "fn-suspended",
            status,
            kind: { case: "jobFunction" as const, value: { name: "job" } },
            position: { depth: 0, parentWorkflowJobExecutionId: "" },
          },
        ],
      },
    });
    const callRecord = '{"arg":{},"arg_hash":"abc","call_index":0,"job_name":"child"}';

    test("does not follow the suspended call, whose result is only a record of it", async () => {
      const client = createClient();
      client.getWorkflowExecution
        .mockResolvedValueOnce(withMain(WorkflowJobExecution_Status.SUSPEND))
        .mockRejectedValue(gone);

      const outcome = await awaitWorkflowRun({
        client,
        workspaceId: "ws",
        started,
        pollInterval: 1,
        timeoutMs: 1000,
      });

      expect(outcome).toMatchObject({ state: "outcomeUnavailable", workflowRemoved: true });
      expect(client.getFunctionExecution).not.toHaveBeenCalled();
    });

    test("does not report a call record as the result when the job it follows had suspended by then", async () => {
      const client = createClient();
      client.getWorkflowExecution
        .mockResolvedValueOnce(withMain(WorkflowJobExecution_Status.RUNNING))
        .mockRejectedValue(gone);
      client.getFunctionExecution.mockResolvedValue({
        execution: {
          status: FunctionExecution_Status.SUCCESS,
          logEntries: [],
          result: callRecord,
        },
      });

      const outcome = await awaitWorkflowRun({
        client,
        workspaceId: "ws",
        started,
        pollInterval: 1,
        timeoutMs: 1000,
      });

      expect(outcome).toMatchObject({ state: "outcomeUnavailable", workflowRemoved: true });
    });
  });

  test("reports a job that failed as a failed script", async () => {
    const client = createClient();
    client.getWorkflowExecution.mockResolvedValueOnce(running).mockRejectedValue(gone);
    client.getFunctionExecution.mockResolvedValue({
      execution: {
        status: FunctionExecution_Status.FAILED,
        logEntries: [],
        result: "",
        error: { message: "boom" },
      },
    });

    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome).toEqual({
      state: "finished",
      result: { success: false, logs: "", result: "", error: "boom" },
    });
  });

  test("reports the outcome as unavailable when the job's execution was never seen", async () => {
    const client = createClient();
    client.getWorkflowExecution.mockRejectedValue(gone);

    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome).toMatchObject({ state: "outcomeUnavailable", workflowRemoved: true });
  });

  test("keeps reading the job's execution until it ends when the workflow is removed mid-run", async () => {
    const client = createClient();
    client.getWorkflowExecution.mockResolvedValueOnce(running).mockRejectedValue(gone);
    client.getFunctionExecution
      .mockResolvedValueOnce({
        execution: { status: FunctionExecution_Status.RUNNING, logEntries: [], result: "" },
      })
      .mockResolvedValue({
        execution: {
          status: FunctionExecution_Status.SUCCESS,
          logEntries: [{ message: "done" }],
          result: '{"ok":true}',
        },
      });

    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome).toEqual({
      state: "finished",
      result: { success: true, logs: "done", result: '{"ok":true}' },
    });
  });

  test("stops at the deadline when the lookup of the job's execution never answers", async () => {
    const client = createClient();
    client.getWorkflowExecution.mockResolvedValueOnce(running).mockRejectedValue(gone);
    client.getFunctionExecution.mockImplementation(
      (_request, options) =>
        new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new ConnectError("canceled", Code.Canceled)),
          );
        }),
    );

    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 5,
      timeoutMs: 40,
    });

    expect(outcome).toMatchObject({ state: "outcomeUnavailable", workflowRemoved: true });
  });

  test("reports the outcome as unavailable, saying the workflow is gone, when the job outlasts the wait", async () => {
    const client = createClient();
    client.getWorkflowExecution.mockResolvedValueOnce(running).mockRejectedValue(gone);
    client.getFunctionExecution.mockResolvedValue({
      execution: { status: FunctionExecution_Status.RUNNING, logEntries: [], result: "" },
    });

    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome).toMatchObject({ state: "outcomeUnavailable", workflowRemoved: true });
  });
});

describe("awaitWorkflowRun deadline", () => {
  test("stops waiting at the deadline even when every poll fails transiently", async () => {
    const client = createClient();
    client.getWorkflowExecution.mockRejectedValue(new ConnectError("down", Code.Unavailable));

    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 5,
      timeoutMs: 30,
    });

    expect(outcome).toEqual({ state: "timedOut" });
    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("stops waiting at the deadline when a status lookup never answers", async () => {
    const client = createClient();
    client.getWorkflowExecution.mockImplementation(
      (_request, options) =>
        new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new ConnectError("canceled", Code.Canceled)),
          );
        }),
    );

    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 5,
      timeoutMs: 40,
    });

    expect(outcome).toEqual({ state: "timedOut" });
    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("does not sleep a whole poll interval past the deadline", async () => {
    const client = createClient({ status: WorkflowExecution_Status.RUNNING });
    const before = Date.now();

    const outcome = await awaitWorkflowRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 60_000,
      timeoutMs: 50,
    });

    expect(outcome).toEqual({ state: "timedOut" });
    expect(Date.now() - before).toBeLessThan(2000);
  });
});

interface Remote {
  /** What the resource is (default: a workflow) */
  kind?: "workflow" | "jobFunction" | "function" | undefined;
  name: string;
  labels: Record<string, string>;
  executions?: WorkflowExecution_Status[];
  /** When the platform created the resource */
  createdAt?: Date;
  /** When the executions finished */
  finishedAt?: Date;
  /** Executions started directly on the function, without a workflow */
  functionExecutions?: FunctionExecution_Status[];
}

function createSweepClient(remote: Remote[]) {
  const kindOf = (item: Remote) => item.kind ?? "workflow";
  const listed = (kind: NonNullable<Remote["kind"]>) =>
    remote
      .filter((item) => kindOf(item) === kind)
      .map((item) => ({
        id: `wf-${remote.indexOf(item)}`,
        name: item.name,
        createdAt: item.createdAt && timestampFromDate(item.createdAt),
      }));
  return mockOperatorClient({
    listWorkflows: async () => ({ workflows: listed("workflow"), nextPageToken: "" }),
    listWorkflowJobFunctions: async () => ({
      jobFunctions: listed("jobFunction"),
      nextPageToken: "",
    }),
    listFunctionRegistries: async () => ({
      functions: listed("function"),
      nextPageToken: "",
    }),
    getMetadata: async ({ trn = "" }) => ({
      metadata: { labels: remote.find((item) => trn.endsWith(`:${item.name}`))?.labels ?? {} },
    }),
    listWorkflowExecutions: async ({ workflowName }) => {
      const item = remote.find((candidate) => candidate.name === workflowName);
      return {
        executions: (item?.executions ?? []).map((status, index) => ({
          id: `e${index}`,
          status,
          finishedAt: item?.finishedAt && timestampFromDate(item.finishedAt),
        })),
        nextPageToken: "",
      };
    },
    listFunctionExecutions: async ({ filter }) => {
      const scriptName = filter?.condition?.value?.kind?.value;
      const item = remote.find(
        (candidate) => candidate.kind === "function" && candidate.name === scriptName,
      );
      return {
        executions: (item?.functionExecutions ?? []).map((status, index) => ({
          id: `fe${index}`,
          scriptName: item?.name,
          status,
          finishedAt: item?.finishedAt && timestampFromDate(item.finishedAt),
        })),
        nextPageToken: "",
      };
    },
    deleteWorkflow: async () => ({}),
    deleteWorkflowJobFunction: async () => ({}),
    deleteFunctionRegistry: async () => ({}),
  });
}

describe("reclaimWorkflowRuns", () => {
  const old = new Date(now.getTime() + 60 * 60 * 1000);
  const run = (id: string) => workflowRunLabels({ runId: id });

  test("removes the resources of runs that finished", async () => {
    const client = createSweepClient([
      {
        name: `tmp-run-${runId}`,
        labels: run(runId),
        executions: [WorkflowExecution_Status.SUCCESS],
      },
      { kind: "function", name: `tmp-run-${runId}-main`, labels: run(runId) },
    ]);
    await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

    expect(client.deleteWorkflow.mock.calls[0]?.[0].workflowId).toBe("wf-0");
    expect(client.deleteFunctionRegistry).toHaveBeenCalledWith({
      workspaceId: "ws",
      name: `tmp-run-${runId}-main`,
    });
  });

  test("keeps a run that is still executing", async () => {
    const client = createSweepClient([
      {
        name: `tmp-run-${runId}`,
        labels: run(runId),
        executions: [WorkflowExecution_Status.RUNNING],
      },
    ]);
    await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("keeps a run whose active execution is beyond the first page of executions", async () => {
    const client = createSweepClient([
      { name: `tmp-run-${runId}`, labels: run(runId), executions: [] },
    ]);
    client.listWorkflowExecutions.mockImplementation(async ({ pageToken }) =>
      pageToken
        ? {
            executions: [{ id: "old", status: WorkflowExecution_Status.RUNNING }],
            nextPageToken: "",
          }
        : {
            executions: [
              {
                id: "new",
                status: WorkflowExecution_Status.SUCCESS,
                finishedAt: timestampFromDate(now),
              },
            ],
            nextPageToken: "page-2",
          },
    );

    await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("keeps a run created moments ago that has not started yet", async () => {
    const client = createSweepClient([
      { name: `tmp-run-${runId}`, labels: run(runId), executions: [] },
    ]);
    await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: new Date(now.getTime() + 5000),
    });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("removes a run that never started once it is old enough", async () => {
    const client = createSweepClient([
      { name: `tmp-run-${runId}`, labels: run(runId), executions: [] },
    ]);
    await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).toHaveBeenCalledOnce();
  });

  describe("for a run that started its function directly, without a workflow", () => {
    const directFunction = (functionExecutions: FunctionExecution_Status[], finishedAt?: Date) =>
      createSweepClient([
        {
          kind: "function",
          name: `tmp-fn-${runId}`,
          labels: run(runId),
          functionExecutions,
          ...(finishedAt === undefined ? {} : { finishedAt }),
        },
      ]);

    test("keeps the function while its execution is still running", async () => {
      const client = directFunction([FunctionExecution_Status.RUNNING]);
      await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

      expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
    });

    test("keeps the function while its execution is running even when `workflow prune` asks to remove finished runs at once", async () => {
      const client = directFunction([FunctionExecution_Status.RUNNING]);
      await reclaimWorkflowRuns({
        client,
        workspaceId: "ws",
        now: old,
        ignoreFinishedGrace: true,
      });

      expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
    });

    test("keeps the function of an execution that finished moments ago, so its waiter can read the outcome", async () => {
      const client = directFunction([FunctionExecution_Status.SUCCESS], old);
      await reclaimWorkflowRuns({
        client,
        workspaceId: "ws",
        now: new Date(old.getTime() + 5000),
      });

      expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
    });

    test("removes the function of an execution that finished long ago", async () => {
      const client = directFunction([FunctionExecution_Status.FAILED], now);
      await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

      expect(client.deleteFunctionRegistry).toHaveBeenCalledWith({
        workspaceId: "ws",
        name: `tmp-fn-${runId}`,
      });
    });

    test("reports the removed run by the name of its function", async () => {
      const client = directFunction([FunctionExecution_Status.FAILED], now);
      const { removed } = await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

      expect(removed).toEqual([`tmp-fn-${runId}`]);
    });

    test("removes the function of a finished execution at once when asked to", async () => {
      const client = directFunction([FunctionExecution_Status.SUCCESS], old);
      await reclaimWorkflowRuns({
        client,
        workspaceId: "ws",
        now: new Date(old.getTime() + 5000),
        ignoreFinishedGrace: true,
      });

      expect(client.deleteFunctionRegistry).toHaveBeenCalledOnce();
    });
  });

  test("removes a finished workflow run whose job function stays suspended after it started another job", async () => {
    const client = createSweepClient([
      {
        name: `tmp-run-${runId}`,
        labels: run(runId),
        executions: [WorkflowExecution_Status.SUCCESS],
      },
      {
        kind: "function",
        name: `tmp-run-${runId}-main`,
        labels: run(runId),
        functionExecutions: [FunctionExecution_Status.SUSPEND],
      },
    ]);
    await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).toHaveBeenCalledOnce();
  });

  test("leaves workflows that are not runs alone", async () => {
    const client = createSweepClient([
      {
        name: "nightly",
        labels: { "sdk-name": "app" },
        executions: [WorkflowExecution_Status.SUCCESS],
      },
    ]);
    await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("leaves a workflow alone when its name is not the one a run gives its resources", async () => {
    const client = createSweepClient([
      { name: "orders", labels: run(runId), executions: [WorkflowExecution_Status.SUCCESS] },
    ]);
    await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });

  test("leaves a workflow alone when an app owns it, whatever else it is labeled", async () => {
    const client = createSweepClient([
      {
        name: `tmp-run-${runId}`,
        labels: { ...run(runId), "sdk-name": "app" },
        executions: [WorkflowExecution_Status.SUCCESS],
      },
    ]);
    await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("does not report a run as removed when its removal failed", async () => {
    const client = createSweepClient([
      {
        name: `tmp-run-${runId}`,
        labels: run(runId),
        executions: [WorkflowExecution_Status.SUCCESS],
      },
    ]);
    client.deleteWorkflow.mockRejectedValueOnce(new ConnectError("boom", Code.Unavailable));

    const { removed } = await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
    });

    expect(removed).toEqual([]);
  });

  test("keeps a run that finished moments ago, so its waiter can read the outcome", async () => {
    const client = createSweepClient([
      {
        name: `tmp-run-${runId}`,
        labels: run(runId),
        executions: [WorkflowExecution_Status.SUCCESS],
        finishedAt: new Date(old.getTime() - 10_000),
      },
    ]);
    await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("keeps a run for the whole window a waiter polling at the longest allowed interval may need", async () => {
    const client = createSweepClient([
      {
        name: `tmp-run-${runId}`,
        labels: run(runId),
        executions: [WorkflowExecution_Status.SUCCESS],
        finishedAt: new Date(old.getTime() - 3 * 60_000),
      },
    ]);
    await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("removes a run that finished long ago", async () => {
    const client = createSweepClient([
      {
        name: `tmp-run-${runId}`,
        labels: run(runId),
        executions: [WorkflowExecution_Status.SUCCESS],
        finishedAt: new Date(old.getTime() - 10 * 60_000),
      },
    ]);
    await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).toHaveBeenCalledOnce();
  });

  test("removes a run that finished moments ago when asked to ignore the grace", async () => {
    const client = createSweepClient([
      {
        name: `tmp-run-${runId}`,
        labels: run(runId),
        executions: [WorkflowExecution_Status.SUCCESS],
        finishedAt: new Date(old.getTime() - 10_000),
      },
    ]);
    await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
      ignoreFinishedGrace: true,
    });

    expect(client.deleteWorkflow).toHaveBeenCalledOnce();
  });

  test("measures the wait for a run that has not started from the workflow's creation, not the run id", async () => {
    const client = createSweepClient([
      {
        name: `tmp-run-${runId}`,
        labels: run(runId),
        executions: [],
        createdAt: new Date(old.getTime() - 5000),
      },
    ]);
    await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("reports a failed removal only to the debug output when asked to stay quiet", async () => {
    vi.mocked(logger.warn).mockClear();
    const client = createSweepClient([
      {
        name: `tmp-run-${runId}`,
        labels: run(runId),
        executions: [WorkflowExecution_Status.SUCCESS],
      },
    ]);
    client.deleteWorkflow.mockRejectedValueOnce(new ConnectError("boom", Code.Unavailable));

    await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
      quiet: true,
    });

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining(`tmp-run-${runId}`));
  });

  test("reports a workflow that has no metadata yet as unlabeled and still sweeps the others", async () => {
    const other = createRunId(now, "bbbbbb");
    const client = createSweepClient([
      {
        name: `tmp-run-${runId}`,
        labels: run(runId),
        executions: [WorkflowExecution_Status.SUCCESS],
      },
      {
        name: `tmp-run-${other}`,
        labels: run(other),
        executions: [WorkflowExecution_Status.SUCCESS],
      },
    ]);
    client.getMetadata.mockRejectedValueOnce(new ConnectError("gone", Code.NotFound));

    const { removed, keptUnlabeled } = await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
    });

    expect(removed).toEqual([`tmp-run-${other}`]);
    expect(keptUnlabeled).toEqual([{ kind: "workflow", name: `tmp-run-${runId}` }]);
  });

  test("reads the metadata of the listed resources at the same time, not one after another", async () => {
    const probe = createConcurrencyProbe();
    const client = createSweepClient(
      ["a", "b", "c"].map((id) => ({
        name: `tmp-run-${createRunId(now, `${id.repeat(6)}`)}`,
        labels: {},
        executions: [],
      })),
    );
    client.getMetadata.mockImplementation(async () => {
      await probe.run();
      return { metadata: { labels: {} } };
    });

    await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

    expect(probe.maxInFlight()).toBeGreaterThan(1);
  });

  test("does not read the labels of resources whose name is not in the namespace of a run's", async () => {
    const client = createSweepClient([
      { name: "nightly", labels: { "sdk-name": "app" }, executions: [] },
      { kind: "jobFunction", name: "validate-order", labels: {} },
      { kind: "function", name: "workflow--validate-order", labels: {} },
    ]);
    await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

    expect(client.getMetadata).not.toHaveBeenCalled();
  });
});

describe("reclaimWorkflowRuns across the resources of a run", () => {
  const old = new Date(now.getTime() + 60 * 60 * 1000);
  const run = (id: string) => workflowRunLabels({ runId: id });
  const name = `tmp-run-${runId}`;

  test("removes the workflow, every job function and every function of a run that registered several jobs", async () => {
    const client = createSweepClient([
      { name, labels: run(runId), executions: [WorkflowExecution_Status.SUCCESS] },
      { kind: "jobFunction", name: `${name}-parent`, labels: run(runId) },
      { kind: "jobFunction", name: `${name}-child`, labels: run(runId) },
      { kind: "function", name: `${name}-parent`, labels: run(runId) },
      { kind: "function", name: `${name}-child`, labels: run(runId) },
    ]);

    const { removed } = await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
    });

    expect(removed).toEqual([name]);
    expect(client.deleteWorkflow).toHaveBeenCalledOnce();
    expect(
      client.deleteWorkflowJobFunction.mock.calls.map(([request]) => request.jobFunctionName),
    ).toEqual([`${name}-parent`, `${name}-child`]);
    expect(client.deleteFunctionRegistry.mock.calls.map(([request]) => request.name)).toEqual([
      `${name}-parent`,
      `${name}-child`,
    ]);
  });

  test("removes the labeled functions a run left after its workflow was removed", async () => {
    const client = createSweepClient([
      { kind: "jobFunction", name: `${name}-parent`, labels: run(runId) },
      { kind: "function", name: `${name}-parent`, labels: run(runId) },
    ]);

    const { removed } = await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
    });

    expect(removed).toEqual([name]);
    expect(client.deleteWorkflow).not.toHaveBeenCalled();
    expect(client.deleteWorkflowJobFunction).toHaveBeenCalledOnce();
    expect(client.deleteFunctionRegistry).toHaveBeenCalledOnce();
  });

  test("keeps the functions of a run that is registering them and has no workflow yet", async () => {
    const client = createSweepClient([
      { kind: "function", name: `${name}-parent`, labels: run(runId) },
    ]);

    await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: new Date(now.getTime() + 5000),
    });

    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });

  test("leaves a job function alone when its name is not one this run gives", async () => {
    const client = createSweepClient([
      { kind: "jobFunction", name: `${name}extra`, labels: run(runId) },
      { kind: "jobFunction", name: "tmp-run-other", labels: run(runId) },
    ]);

    await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

    expect(client.deleteWorkflowJobFunction).not.toHaveBeenCalled();
  });

  test("leaves a function alone when an app owns it", async () => {
    const client = createSweepClient([
      { kind: "function", name, labels: { ...run(runId), "sdk-name": "app" } },
    ]);

    await reclaimWorkflowRuns({ client, workspaceId: "ws", now: old });

    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });
});

describe("reclaimWorkflowRuns with resources that carry no run label", () => {
  const old = new Date(now.getTime() + 60 * 60 * 1000);
  const orphan = (kind: Remote["kind"], extra: Partial<Remote> = {}): Remote => ({
    kind,
    name: "tmp-run-r00zzz-x",
    labels: {},
    ...extra,
  });

  test("reports them and removes nothing without the flag", async () => {
    const client = createSweepClient([orphan("jobFunction"), orphan("function")]);

    const result = await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
    });

    expect(result.keptUnlabeled).toEqual([
      { kind: "job function", name: "tmp-run-r00zzz-x" },
      { kind: "function", name: "tmp-run-r00zzz-x" },
    ]);
    expect(client.deleteWorkflowJobFunction).not.toHaveBeenCalled();
    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });

  test("removes them with the flag, a workflow before the job functions and functions it uses", async () => {
    const order: string[] = [];
    const client = createSweepClient([
      orphan("function"),
      orphan("jobFunction"),
      orphan("workflow", { executions: [WorkflowExecution_Status.SUCCESS] }),
    ]);
    client.deleteWorkflow.mockImplementation(async () => {
      order.push("workflow");
      return {};
    });
    client.deleteWorkflowJobFunction.mockImplementation(async () => {
      order.push("job function");
      return {};
    });
    client.deleteFunctionRegistry.mockImplementation(async () => {
      order.push("function");
      return {};
    });

    const result = await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
      includeUnlabeled: true,
    });

    expect(order).toEqual(["workflow", "job function", "function"]);
    expect(result.removedUnlabeled).toHaveLength(3);
    expect(result.keptUnlabeled).toEqual([]);
  });

  test("leaves one created moments ago alone, since its run may be about to label it", async () => {
    const client = createSweepClient([
      orphan("function", { createdAt: new Date(old.getTime() - 5000) }),
    ]);

    const result = await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
      includeUnlabeled: true,
    });

    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
    expect(result.keptUnlabeled).toEqual([]);
  });

  test("leaves a workflow with an execution still going alone even with the flag", async () => {
    const client = createSweepClient([
      orphan("workflow", { executions: [WorkflowExecution_Status.RUNNING] }),
    ]);

    await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
      includeUnlabeled: true,
    });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("leaves the function of an async run that is still executing alone even with the flag", async () => {
    const client = createSweepClient([
      orphan("function", {
        name: `tmp-fn-${runId}`,
        functionExecutions: [FunctionExecution_Status.RUNNING],
      }),
    ]);

    await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
      includeUnlabeled: true,
    });

    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });

  test("never counts a resource an app owns as unlabeled", async () => {
    const client = createSweepClient([orphan("function", { labels: { "sdk-name": "app" } })]);

    const result = await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
      includeUnlabeled: true,
    });

    expect(result.keptUnlabeled).toEqual([]);
    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });
});

describe("reclaimWorkflowRuns for a workflow that is still running", () => {
  const old = new Date(now.getTime() + 60 * 60 * 1000);

  test("keeps the functions of a run whose workflow lost its run label", async () => {
    const name = `tmp-run-${runId}`;
    const client = createSweepClient([
      { name, labels: {}, executions: [WorkflowExecution_Status.RUNNING] },
      {
        kind: "function",
        name: `${name}-main`,
        labels: workflowRunLabels({ runId }),
      },
    ]);

    const result = await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
    });

    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
    expect(result.removed).toEqual([]);
  });

  test("keeps an unlabeled job function of a running labeled workflow even with the flag", async () => {
    const name = `tmp-run-${runId}`;
    const client = createSweepClient([
      {
        name,
        labels: workflowRunLabels({ runId }),
        executions: [WorkflowExecution_Status.RUNNING],
      },
      { kind: "jobFunction", name: `${name}-main`, labels: {} },
    ]);

    const result = await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
      includeUnlabeled: true,
    });

    expect(client.deleteWorkflowJobFunction).not.toHaveBeenCalled();
    expect(result.removedUnlabeled).toEqual([]);
  });

  test("keeps an unlabeled function of a labeled run that finished moments ago, even with the flag", async () => {
    const name = `tmp-run-${runId}`;
    const client = createSweepClient([
      {
        name,
        labels: workflowRunLabels({ runId }),
        executions: [WorkflowExecution_Status.SUCCESS],
        finishedAt: new Date(old.getTime() - 1000),
      },
      { kind: "function", name: `${name}-main`, labels: {} },
    ]);

    await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
      includeUnlabeled: true,
    });

    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });

  describe("when a finished run's workflow has no run label", () => {
    const name = `tmp-run-${runId}`;
    const remote = (): Remote[] => [
      { name, labels: {}, executions: [WorkflowExecution_Status.SUCCESS] },
      {
        kind: "jobFunction",
        name: `${name}-main`,
        labels: workflowRunLabels({ runId }),
      },
      { kind: "function", name: `${name}-main`, labels: workflowRunLabels({ runId }) },
    ];

    test("keeps the workflow's job functions and functions along with the workflow", async () => {
      const client = createSweepClient(remote());

      const result = await reclaimWorkflowRuns({
        client,
        workspaceId: "ws",
        now: old,
      });

      expect(client.deleteWorkflowJobFunction).not.toHaveBeenCalled();
      expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
      expect(client.deleteWorkflow).not.toHaveBeenCalled();
      expect(result.removed).toEqual([]);
      expect(result.keptUnlabeled).toEqual([{ kind: "workflow", name }]);
    });

    test("removes the workflow together with its job functions and functions when asked", async () => {
      const client = createSweepClient(remote());

      const result = await reclaimWorkflowRuns({
        client,
        workspaceId: "ws",
        now: old,
        includeUnlabeled: true,
      });

      expect(client.deleteWorkflow).toHaveBeenCalledTimes(1);
      expect(client.deleteWorkflowJobFunction).toHaveBeenCalledTimes(1);
      expect(client.deleteFunctionRegistry).toHaveBeenCalledTimes(1);
      expect(result.removed).toEqual([name]);
      expect(result.removedUnlabeled).toEqual([{ kind: "workflow", name }]);
    });
  });

  test("keeps the job functions and functions of an unlabeled running workflow even with the flag", async () => {
    const client = createSweepClient([
      { name: "tmp-run-r00zzz", labels: {}, executions: [WorkflowExecution_Status.RUNNING] },
      { kind: "jobFunction", name: "tmp-run-r00zzz-main", labels: {} },
      { kind: "function", name: "tmp-run-r00zzz-main", labels: {} },
      { kind: "function", name: "tmp-run-r00aaa-other", labels: {} },
    ]);

    const result = await reclaimWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
      includeUnlabeled: true,
    });

    expect(client.deleteWorkflowJobFunction).not.toHaveBeenCalled();
    expect(client.deleteFunctionRegistry.mock.calls).toEqual([
      [{ workspaceId: "ws", name: "tmp-run-r00aaa-other" }],
    ]);
    expect(result.removedUnlabeled).toEqual([{ kind: "function", name: "tmp-run-r00aaa-other" }]);
  });
});

describe("reclaimFinishedWorkflowRuns", () => {
  const old = new Date(now.getTime() + 60 * 60 * 1000);

  test("removes finished runs and reports how many", async () => {
    const client = createSweepClient([
      {
        name: `tmp-run-${runId}`,
        labels: workflowRunLabels({ runId }),
        executions: [WorkflowExecution_Status.SUCCESS],
      },
    ]);

    const swept = await reclaimFinishedWorkflowRuns({
      client,
      workspaceId: "ws",
      now: old,
    });

    expect(swept?.removed).toEqual([`tmp-run-${runId}`]);
  });

  test("does not fail the caller when the sweep itself fails", async () => {
    const client = createSweepClient([]);
    client.listWorkflows.mockRejectedValueOnce(new ConnectError("down", Code.Unavailable));

    await expect(
      reclaimFinishedWorkflowRuns({ client, workspaceId: "ws", now: old }),
    ).resolves.toBeUndefined();
  });
});

describe("workflowRunHints", () => {
  test("names the workspace and profile the run used in both recovery commands", () => {
    const hints = workflowRunHints({
      executionId: "exec-1",
      workspaceId: "ws-1",
      profile: "staging",
    });

    expect(hints.inspect).toContain("tailor workflow executions exec-1");
    expect(hints.inspect).toContain("--logs");
    expect(hints.inspect).toContain("ws-1");
    expect(hints.inspect).toContain("staging");
    expect(hints.prune).toContain("tailor workflow prune");
    expect(hints.prune).toContain("ws-1");
    expect(hints.prune).toContain("staging");
  });
});

describe("assertWaitTimeout", () => {
  test("accepts the longest wait a timer can count", () => {
    expect(() => assertWaitTimeout(2_147_483_647)).not.toThrow();
  });

  test("accepts a wait without a limit", () => {
    expect(() => assertWaitTimeout(Number.POSITIVE_INFINITY)).not.toThrow();
  });

  test("refuses a wait the timer would end at once, with a code of its own", () => {
    expect(() => assertWaitTimeout(2_147_483_648)).toThrow(
      expect.objectContaining({ code: "WORKFLOW_RUN_TIMEOUT_TOO_LONG" }),
    );
  });
});

describe("the checks of a wait name the command that waits", () => {
  test("a poll interval that is too long", () => {
    expect(() => assertPollInterval(60_001, "function run")).toThrow(
      expect.objectContaining({ command: "function run" }),
    );
    expect(() => assertPollInterval(60_001)).toThrow(
      expect.objectContaining({ command: "workflow run" }),
    );
  });

  test("a timeout that is too long", () => {
    expect(() => assertWaitTimeout(2_147_483_648, "function run")).toThrow(
      expect.objectContaining({ command: "function run" }),
    );
  });
});

describe("assertPollInterval", () => {
  test("accepts the longest interval a finished run is protected for", () => {
    expect(() => assertPollInterval(60_000)).not.toThrow();
  });

  test("rejects a longer interval, since the run could be removed before the next poll", () => {
    expect(() => assertPollInterval(60_001)).toThrow(/interval/i);
  });
});

describe("assertWorkflowArg", () => {
  test.each([undefined, null, {}, { a: [1] }])("accepts %j", (value) => {
    expect(() => assertWorkflowArg(value as never)).not.toThrow();
  });

  test.each([5, "text", true, [1, 2]])(
    "rejects %j, which the platform ends without a message after the start",
    (value) => {
      expect(() => assertWorkflowArg(value as never)).toThrow(/JSON object/);
    },
  );
});

describe("pruneHint", () => {
  test("names the workspace and profile the run used, also with --include-unlabeled", () => {
    expect(
      pruneHint({ workspaceId: "ws-1", profile: "staging", includeUnlabeled: true }),
    ).toContain("tailor workflow prune --include-unlabeled");
    expect(pruneHint({ workspaceId: "ws-1", profile: "staging", includeUnlabeled: true })).toMatch(
      /ws-1/,
    );
    expect(pruneHint({ workspaceId: "ws-1", profile: "staging", includeUnlabeled: true })).toMatch(
      /staging/,
    );
  });

  test("leaves out --include-unlabeled unless asked", () => {
    expect(pruneHint({ workspaceId: "ws-1", profile: undefined })).not.toContain(
      "--include-unlabeled",
    );
  });
});
