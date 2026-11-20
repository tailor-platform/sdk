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
import {
  mockOperatorClient,
  type OperatorClientMocks,
  withOperatorClientMocks,
} from "#/cli/shared/test-helpers/operator-client";
import { stripAnsi } from "#/cli/shared/test-helpers/strip-ansi";
import {
  getExecutorWaitFailure,
  getExecutorWaitFailureMessage,
  jobsCommand,
  watchExecutorJob,
} from "./jobs";
import type { OperatorClient } from "#/cli/shared/client";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { ListExecutorJobAttemptsResponseSchema } from "@tailor-platform/tailor-proto/executor_pb";
import type { ExecutorJobSchema } from "@tailor-platform/tailor-proto/executor_resource_pb";

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

function executorJob(status: ExecutorJobStatus): MessageInitShape<typeof ExecutorJobSchema> {
  return {
    id: "job-1",
    executorName: "my-executor",
    status,
  };
}

function mockClient<K extends keyof OperatorClient = never>(
  targetType = ExecutorTargetType.WEBHOOK,
  overrides?: OperatorClientMocks<K>,
) {
  const client = withOperatorClientMocks(
    mockOperatorClient({
      getExecutorExecutor: { executor: { targetType } },
      getExecutorJob: { job: executorJob(ExecutorJobStatus.SUCCESS) },
      listExecutorJobAttempts: { attempts: [], nextPageToken: "" },
    }),
    overrides,
  );
  vi.mocked(initOperatorClient).mockResolvedValue(client);
  return client;
}

describe("watchExecutorJob", () => {
  let client: ReturnType<typeof mockClient<never>>;

  aroundEach(async (runTest) => {
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");

    client = mockClient();
    client.getExecutorJob
      .mockRejectedValueOnce(new ConnectError("temporarily unavailable", Code.Unavailable))
      .mockResolvedValueOnce({
        job: executorJob(ExecutorJobStatus.SUCCESS),
      });
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
    client.getExecutorJob.mockReset().mockResolvedValue({
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
    const workflowClient = mockClient(ExecutorTargetType.WORKFLOW, {
      listExecutorJobAttempts: {
        attempts: [
          {
            id: "attempt-1",
            jobId: "job-1",
            status: ExecutorJobStatus.SUCCESS,
            operationReference: "workflow-execution-1",
          },
        ],
        nextPageToken: "",
      },
      getWorkflowExecution: {},
    });
    workflowClient.getWorkflowExecution
      .mockResolvedValueOnce({
        execution: {
          id: "workflow-execution-1",
          workflowName: "daily-workflow",
          status: WorkflowExecution_Status.FAILED,
          jobExecutions: [],
        },
      })
      .mockRejectedValueOnce(new Error("logs unavailable"));

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
    mockClient(ExecutorTargetType.WORKFLOW, {
      listExecutorJobAttempts: {
        attempts: [
          {
            id: "attempt-1",
            jobId: "job-1",
            status: ExecutorJobStatus.SUCCESS,
            operationReference: "workflow-execution-1",
          },
        ],
        nextPageToken: "",
      },
      getWorkflowExecution: {
        execution: {
          id: "workflow-execution-1",
          workflowName: "daily-workflow",
          status: WorkflowExecution_Status.CANCELED,
          jobExecutions: [],
        },
      },
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
    mockClient(ExecutorTargetType.FUNCTION, {
      listExecutorJobAttempts: {
        attempts: [
          {
            id: "attempt-1",
            jobId: "job-1",
            status: ExecutorJobStatus.SUCCESS,
            operationReference: "function-execution-1",
          },
        ],
        nextPageToken: "",
      },
      getFunctionExecution: {
        execution: {
          status: FunctionExecution_Status.CANCELED,
          result: "Execution canceled",
        },
      },
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

  function attemptsReferencing(
    operationReference: string,
  ): MessageInitShape<typeof ListExecutorJobAttemptsResponseSchema> {
    return {
      attempts: [
        { id: "attempt-1", jobId: "job-1", status: ExecutorJobStatus.SUCCESS, operationReference },
      ],
      nextPageToken: "",
    };
  }

  aroundEach(async (runTest) => {
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
    await runTest();
  });

  test("marks function log lines the Platform wrote", async () => {
    using _stdout = captureStdout();
    using stderr = captureStderr();
    mockClient(ExecutorTargetType.FUNCTION, {
      listExecutorJobAttempts: attemptsReferencing("function-execution-1"),
      getFunctionExecution: { execution: functionExecution },
    });

    await runCommand(jobsCommand, ["my-executor", "job-1", "-W", "-l", "-i", "1ms"]);

    expect(stripAnsi(stderr.output)).toContain(
      "  Logs:\n    step 1\n    step 2\n    [PLATFORM] runs close to the limit\n    [PLATFORM] move long work elsewhere\n",
    );
  });

  test("reports the source of each function log entry", async () => {
    mockClient(ExecutorTargetType.FUNCTION, {
      listExecutorJobAttempts: attemptsReferencing("function-execution-1"),
      getFunctionExecution: { execution: functionExecution },
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
    mockClient(ExecutorTargetType.WORKFLOW, {
      listExecutorJobAttempts: attemptsReferencing("workflow-execution-1"),
      getWorkflowExecution: {
        execution: {
          id: "workflow-execution-1",
          workflowName: "daily-workflow",
          status: WorkflowExecution_Status.SUCCESS,
          jobExecutions: [
            {
              id: "job-execution-1",
              stackedJobName: "main/fetch#0",
              kind: { case: "jobFunction", value: { name: "fetch" } },
              status: WorkflowJobExecution_Status.SUCCESS,
              executionId: "function-execution-1",
            },
          ],
        },
      },
      getFunctionExecution: { execution: functionExecution },
    });

    const result = await watchExecutorJob({
      executor: { name: "my-executor" },
      jobId: "job-1",
      interval: 1,
      logs: true,
      showProgress: false,
    });
    await runCommand(jobsCommand, ["my-executor", "job-1", "-W", "-l", "-i", "1ms"]);

    expect(result.workflowJobLogs?.[0]).toMatchObject({
      jobExecutionId: "job-execution-1",
      kind: { type: "jobFunction", name: "fetch" },
    });
    expect(result.workflowJobLogs?.[0]).not.toHaveProperty("jobName");
    expect(stripAnsi(stderr.output)).toContain("  Job: fetch (job-execution-1)\n");
    expect(result.workflowJobLogs?.[0]?.logEntries).toMatchObject([
      { source: "USER" },
      { source: "PLATFORM" },
    ]);
    expect(stripAnsi(stderr.output)).toContain(
      "    Logs:\n      step 1\n      step 2\n      [PLATFORM] runs close to the limit\n      [PLATFORM] move long work elsewhere\n",
    );
  });

  test("heads a workflow job of an unknown kind with its id alone", async () => {
    using _stdout = captureStdout();
    using stderr = captureStderr();
    mockClient(ExecutorTargetType.WORKFLOW, {
      listExecutorJobAttempts: attemptsReferencing("workflow-execution-1"),
      getWorkflowExecution: {
        execution: {
          id: "workflow-execution-1",
          workflowName: "daily-workflow",
          status: WorkflowExecution_Status.SUCCESS,
          jobExecutions: [
            {
              id: "job-execution-9",
              kind: { case: undefined },
              status: WorkflowJobExecution_Status.SUCCESS,
              executionId: "function-execution-1",
            },
          ],
        },
      },
      getFunctionExecution: { execution: functionExecution },
    });

    await runCommand(jobsCommand, ["my-executor", "job-1", "-W", "-l", "-i", "1ms"]);

    expect(stripAnsi(stderr.output)).toContain("  Job: job-execution-9\n");
  });
});
