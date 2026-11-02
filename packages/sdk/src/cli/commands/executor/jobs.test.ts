import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import {
  ExecutorJobStatus,
  ExecutorTargetType,
} from "@tailor-platform/tailor-proto/executor_resource_pb";
import {
  FunctionExecution_Status,
  FunctionExecutionSchema,
  FunctionLogSeverity,
  FunctionLogSource,
} from "@tailor-platform/tailor-proto/function_resource_pb";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { stripAnsi } from "#/cli/shared/test-helpers/strip-ansi";
import {
  getExecutorWaitFailure,
  getExecutorWaitFailureMessage,
  jobsCommand,
  watchExecutorJob,
} from "./jobs";
import type { ExecutorJob } from "@tailor-platform/tailor-proto/executor_resource_pb";
import type { WorkflowExecution } from "@tailor-platform/tailor-proto/workflow_resource_pb";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("#/cli/shared/client", () => ({
  fetchAll: async <T>(
    fn: (pageToken: string, maxPageSize: number) => Promise<[T[], string]>,
  ): Promise<T[]> => {
    const [items] = await fn("", 1000);
    return items;
  },
  initOperatorClient: vi.fn(),
}));

function executorJob(status: ExecutorJobStatus): ExecutorJob {
  return {
    id: "job-1",
    executorName: "my-executor",
    status,
  } as ExecutorJob;
}

type OperatorClientMockOverrides = {
  [K in keyof Awaited<ReturnType<typeof initOperatorClient>>]?: ReturnType<typeof vi.fn>;
} & {
  targetType?: ExecutorTargetType;
};

function mockOperatorClient(overrides: OperatorClientMockOverrides = {}) {
  const { targetType = ExecutorTargetType.WEBHOOK, ...rest } = overrides;
  vi.mocked(initOperatorClient).mockResolvedValue({
    getExecutorExecutor: vi.fn().mockResolvedValue({ executor: { targetType } }),
    getExecutorJob: vi.fn().mockResolvedValue({ job: executorJob(ExecutorJobStatus.SUCCESS) }),
    listExecutorJobAttempts: vi.fn().mockResolvedValue({ attempts: [], nextPageToken: "" }),
    ...rest,
  } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
}

describe("watchExecutorJob", () => {
  let getExecutorJobMock: ReturnType<typeof vi.fn>;

  aroundEach(async (runTest) => {
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");

    getExecutorJobMock = vi
      .fn()
      .mockRejectedValueOnce(new ConnectError("temporarily unavailable", Code.Unavailable))
      .mockResolvedValueOnce({
        job: executorJob(ExecutorJobStatus.SUCCESS),
      });

    mockOperatorClient({ getExecutorJob: getExecutorJobMock });
    await runTest();
  });

  test("retries retryable job polling failures", async () => {
    const result = await watchExecutorJob({
      executor: { name: "my-executor" },
      jobId: "job-1",
      interval: 1,
      timeout: 100,
      showProgress: false,
    });

    expect(result).toMatchObject({
      targetType: "WEBHOOK",
      attempts: 2,
      timedOut: false,
      lastError: null,
      job: {
        id: "job-1",
        executorName: "my-executor",
        status: "SUCCESS",
      },
    });
  });

  test("returns timeout diagnostics with the last observed job status", async () => {
    getExecutorJobMock.mockReset().mockResolvedValue({
      job: executorJob(ExecutorJobStatus.PENDING),
    });

    const result = await watchExecutorJob({
      executor: { name: "my-executor" },
      jobId: "job-1",
      interval: 1,
      timeout: 5,
      showProgress: false,
    });

    expect(result).toMatchObject({
      targetType: "WEBHOOK",
      timedOut: true,
      lastError: null,
      job: {
        id: "job-1",
        executorName: "my-executor",
        status: "PENDING",
      },
    });
    expect(result.attempts).toBeGreaterThan(0);
  });

  test("preserves workflow failure status when optional log fetch fails", async () => {
    const getWorkflowExecutionMock = vi
      .fn()
      .mockResolvedValueOnce({
        execution: {
          id: "workflow-execution-1",
          workflowName: "daily-workflow",
          status: WorkflowExecution_Status.FAILED,
          jobExecutions: [],
        } as unknown as WorkflowExecution,
      })
      .mockRejectedValueOnce(new Error("logs unavailable"));

    mockOperatorClient({
      targetType: ExecutorTargetType.WORKFLOW,
      listExecutorJobAttempts: vi.fn().mockResolvedValue({
        attempts: [
          {
            id: "attempt-1",
            jobId: "job-1",
            status: ExecutorJobStatus.SUCCESS,
            operationReference: "workflow-execution-1",
          },
        ],
        nextPageToken: "",
      }),
      getWorkflowExecution: getWorkflowExecutionMock,
    });

    const result = await watchExecutorJob({
      executor: { name: "my-executor" },
      jobId: "job-1",
      interval: 1,
      timeout: 100,
      logs: true,
      showProgress: false,
    });

    expect(result).toMatchObject({
      targetType: "WORKFLOW",
      workflowExecutionId: "workflow-execution-1",
      workflowStatus: "FAILED",
      timedOut: false,
      job: {
        id: "job-1",
        status: "SUCCESS",
      },
    });
    expect(getExecutorWaitFailure(result)).toMatchObject({
      code: "WORKFLOW_EXECUTION_FAILED",
      message: "Workflow execution 'workflow-execution-1' failed.",
      context: { jobId: "job-1", workflowExecutionId: "workflow-execution-1" },
    });
    expect(getExecutorWaitFailureMessage(result)).toBe(
      "Workflow execution 'workflow-execution-1' failed.",
    );
  });

  test("reports a canceled downstream workflow as a failure", async () => {
    mockOperatorClient({
      targetType: ExecutorTargetType.WORKFLOW,
      listExecutorJobAttempts: vi.fn().mockResolvedValue({
        attempts: [
          {
            id: "attempt-1",
            jobId: "job-1",
            status: ExecutorJobStatus.SUCCESS,
            operationReference: "workflow-execution-1",
          },
        ],
        nextPageToken: "",
      }),
      getWorkflowExecution: vi.fn().mockResolvedValue({
        execution: {
          id: "workflow-execution-1",
          workflowName: "daily-workflow",
          status: WorkflowExecution_Status.CANCELED,
          jobExecutions: [],
        } as unknown as WorkflowExecution,
      }),
    });

    const result = await watchExecutorJob({
      executor: { name: "my-executor" },
      jobId: "job-1",
      interval: 1,
      timeout: 100,
      showProgress: false,
    });

    expect(result).toMatchObject({ workflowStatus: "CANCELED", timedOut: false });
    expect(getExecutorWaitFailure(result)).toMatchObject({
      code: "WORKFLOW_EXECUTION_CANCELED",
      message: "Workflow execution 'workflow-execution-1' was canceled.",
      context: { jobId: "job-1", workflowExecutionId: "workflow-execution-1" },
    });
  });

  test("reports a canceled downstream function as a failure", async () => {
    mockOperatorClient({
      targetType: ExecutorTargetType.FUNCTION,
      listExecutorJobAttempts: vi.fn().mockResolvedValue({
        attempts: [
          {
            id: "attempt-1",
            jobId: "job-1",
            status: ExecutorJobStatus.SUCCESS,
            operationReference: "function-execution-1",
          },
        ],
        nextPageToken: "",
      }),
      getFunctionExecution: vi.fn().mockResolvedValue({
        execution: {
          status: FunctionExecution_Status.CANCELED,
          logs: "canceled logs",
          result: "Execution canceled",
        },
      }),
    });

    const result = await watchExecutorJob({
      executor: { name: "my-executor" },
      jobId: "job-1",
      interval: 1,
      timeout: 100,
      showProgress: false,
    });

    expect(result).toMatchObject({
      targetType: "FUNCTION",
      functionExecutionId: "function-execution-1",
      functionStatus: "CANCELED",
      timedOut: false,
      job: {
        id: "job-1",
        status: "SUCCESS",
      },
    });
    expect(getExecutorWaitFailure(result)).toMatchObject({
      code: "FUNCTION_EXECUTION_CANCELED",
      message: "Function execution 'function-execution-1' was canceled.",
      context: { jobId: "job-1", functionExecutionId: "function-execution-1" },
    });
  });
});

describe("downstream logs", () => {
  const functionExecution = create(FunctionExecutionSchema, {
    id: "function-execution-1",
    status: FunctionExecution_Status.SUCCESS,
    logEntries: [
      {
        message: "step 1\nstep 2",
        severity: FunctionLogSeverity.INFO,
        source: FunctionLogSource.USER,
      },
      {
        message: "runs close to the limit\nmove long work elsewhere",
        severity: FunctionLogSeverity.WARNING,
        source: FunctionLogSource.PLATFORM,
      },
    ],
  });

  function attemptsReferencing(operationReference: string) {
    return vi.fn().mockResolvedValue({
      attempts: [
        { id: "attempt-1", jobId: "job-1", status: ExecutorJobStatus.SUCCESS, operationReference },
      ],
      nextPageToken: "",
    });
  }

  aroundEach(async (runTest) => {
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
    await runTest();
  });

  test("marks function log lines the Platform wrote", async () => {
    using _stdout = captureStdout();
    using stderr = captureStderr();
    mockOperatorClient({
      targetType: ExecutorTargetType.FUNCTION,
      listExecutorJobAttempts: attemptsReferencing("function-execution-1"),
      getFunctionExecution: vi.fn().mockResolvedValue({ execution: functionExecution }),
    });

    await runCommand(jobsCommand, ["my-executor", "job-1", "-W", "-l", "-i", "1ms"]);

    expect(stripAnsi(stderr.output)).toContain(
      "  Logs:\n    step 1\n    step 2\n    [PLATFORM] runs close to the limit\n    [PLATFORM] move long work elsewhere\n",
    );
  });

  test("reports the source of each function log entry", async () => {
    mockOperatorClient({
      targetType: ExecutorTargetType.FUNCTION,
      listExecutorJobAttempts: attemptsReferencing("function-execution-1"),
      getFunctionExecution: vi.fn().mockResolvedValue({ execution: functionExecution }),
    });

    const result = await watchExecutorJob({
      executor: { name: "my-executor" },
      jobId: "job-1",
      interval: 1,
      logs: true,
      showProgress: false,
    });

    expect(result.functionLogEntries).toMatchObject([
      { message: "step 1\nstep 2", source: "USER" },
      { message: "runs close to the limit\nmove long work elsewhere", source: "PLATFORM" },
    ]);
  });

  test("marks workflow job log lines the Platform wrote and reports their source", async () => {
    using _stdout = captureStdout();
    using stderr = captureStderr();
    mockOperatorClient({
      targetType: ExecutorTargetType.WORKFLOW,
      listExecutorJobAttempts: attemptsReferencing("workflow-execution-1"),
      getWorkflowExecution: vi.fn().mockResolvedValue({
        execution: {
          id: "workflow-execution-1",
          workflowName: "daily-workflow",
          status: WorkflowExecution_Status.SUCCESS,
          jobExecutions: [
            {
              id: "job-execution-1",
              stackedJobName: "main",
              status: WorkflowJobExecution_Status.SUCCESS,
              executionId: "function-execution-1",
            },
          ],
        } as unknown as WorkflowExecution,
      }),
      getFunctionExecution: vi.fn().mockResolvedValue({ execution: functionExecution }),
    });

    const result = await watchExecutorJob({
      executor: { name: "my-executor" },
      jobId: "job-1",
      interval: 1,
      logs: true,
      showProgress: false,
    });
    await runCommand(jobsCommand, ["my-executor", "job-1", "-W", "-l", "-i", "1ms"]);

    expect(result.workflowJobLogs?.[0]?.logEntries).toMatchObject([
      { source: "USER" },
      { source: "PLATFORM" },
    ]);
    expect(stripAnsi(stderr.output)).toContain(
      "    Logs:\n      step 1\n      step 2\n      [PLATFORM] runs close to the limit\n      [PLATFORM] move long work elsewhere\n",
    );
  });
});
