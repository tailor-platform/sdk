import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  FunctionExecution_Status,
  FunctionExecutionSchema,
  FunctionLogSeverity,
} from "@tailor-platform/tailor-proto/function_resource_pb";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { captureStderr } from "#/cli/shared/test-helpers/capture-output";
import { stripAnsi } from "#/cli/shared/test-helpers/strip-ansi";
import { getWorkflowExecution, printExecutionWithLogs } from "./executions";
import type { WorkflowExecution } from "@tailor-platform/tailor-proto/workflow_resource_pb";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

function execution(
  status: WorkflowExecution_Status,
  jobExecutions: WorkflowExecution["jobExecutions"] = [],
): WorkflowExecution {
  return {
    id: "execution-1",
    workflowName: "my-workflow",
    status,
    jobExecutions,
  } as unknown as WorkflowExecution;
}

const runningJob = {
  id: "job-1",
  stackedJobName: "main",
  status: WorkflowJobExecution_Status.RUNNING,
  executionId: "fn-exec-1",
} as unknown as WorkflowExecution["jobExecutions"][number];

describe("getWorkflowExecution", () => {
  aroundEach(async (runTest) => {
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
    await runTest();
  });

  test("returns wait diagnostics when waiting times out", async () => {
    vi.mocked(initOperatorClient).mockResolvedValue({
      getWorkflowExecution: vi.fn().mockResolvedValue({
        execution: execution(WorkflowExecution_Status.PENDING),
      }),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

    const { wait } = await getWorkflowExecution({
      executionId: "execution-1",
      interval: 1,
      timeout: 5,
      until: "success",
    });

    const result = await wait();

    expect(result).toMatchObject({
      id: "execution-1",
      status: "PENDING",
      statusClass: "transient",
      timedOut: true,
      lastError: null,
    });
    expect(result.attempts).toBeGreaterThan(0);
  });

  test("fetches each job's function execution by id and exposes its log entries", async () => {
    const getFunctionExecution = vi.fn().mockResolvedValue({
      execution: create(FunctionExecutionSchema, {
        id: "fn-exec-1",
        status: FunctionExecution_Status.RUNNING,
        logEntries: [
          {
            message: "step 1",
            severity: FunctionLogSeverity.INFO,
            timestamp: timestampFromDate(new Date("2026-09-05T00:00:00.000Z")),
          },
        ],
      }),
    });
    vi.mocked(initOperatorClient).mockResolvedValue({
      getWorkflowExecution: vi.fn().mockResolvedValue({
        execution: execution(WorkflowExecution_Status.RUNNING, [runningJob]),
      }),
      getFunctionExecution,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

    const { execution: detail } = await getWorkflowExecution({
      executionId: "execution-1",
      logs: true,
    });

    expect(getFunctionExecution).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      executionId: "fn-exec-1",
    });
    expect(detail.jobDetails).toEqual([
      expect.objectContaining({
        stackedJobName: "main",
        logs: undefined,
        result: undefined,
        logEntries: [
          {
            message: "step 1",
            severity: "INFO",
            timestamp: new Date("2026-09-05T00:00:00.000Z"),
          },
        ],
      }),
    ]);
  });

  test("omits log entries when the function execution has none", async () => {
    vi.mocked(initOperatorClient).mockResolvedValue({
      getWorkflowExecution: vi.fn().mockResolvedValue({
        execution: execution(WorkflowExecution_Status.SUCCESS, [runningJob]),
      }),
      getFunctionExecution: vi.fn().mockResolvedValue({
        execution: create(FunctionExecutionSchema, {
          id: "fn-exec-1",
          status: FunctionExecution_Status.SUCCESS,
          logs: "done",
          result: "1",
        }),
      }),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

    const { execution: detail } = await getWorkflowExecution({
      executionId: "execution-1",
      logs: true,
    });

    expect(detail.jobDetails?.[0]).toMatchObject({ logs: "done", result: "1" });
    expect(detail.jobDetails?.[0]?.logEntries).toBeUndefined();
  });

  test("keeps the job info quietly when the function execution is not found", async () => {
    using stderr = captureStderr();
    vi.mocked(initOperatorClient).mockResolvedValue({
      getWorkflowExecution: vi.fn().mockResolvedValue({
        execution: execution(WorkflowExecution_Status.RUNNING, [runningJob]),
      }),
      getFunctionExecution: vi.fn().mockRejectedValue(new ConnectError("gone", Code.NotFound)),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

    const { execution: detail } = await getWorkflowExecution({
      executionId: "execution-1",
      logs: true,
    });

    expect(detail.jobDetails).toEqual([expect.objectContaining({ stackedJobName: "main" })]);
    expect(detail.jobDetails?.[0]).not.toHaveProperty("logEntries");
    expect(stderr.output).toBe("");
  });

  test("warns and keeps the job info when the function execution lookup fails otherwise", async () => {
    using stderr = captureStderr();
    vi.mocked(initOperatorClient).mockResolvedValue({
      getWorkflowExecution: vi.fn().mockResolvedValue({
        execution: execution(WorkflowExecution_Status.RUNNING, [runningJob]),
      }),
      getFunctionExecution: vi
        .fn()
        .mockRejectedValue(new ConnectError("try later", Code.Unavailable)),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

    const { execution: detail } = await getWorkflowExecution({
      executionId: "execution-1",
      logs: true,
    });

    expect(detail.jobDetails).toEqual([expect.objectContaining({ stackedJobName: "main" })]);
    expect(stripAnsi(stderr.output)).toContain(
      "Could not fetch logs for function execution 'fn-exec-1'",
    );
    expect(stripAnsi(stderr.output)).toContain("try later");
  });
});

describe("printExecutionWithLogs", () => {
  const base = {
    id: "execution-1",
    workflowName: "my-workflow",
    status: "RUNNING",
    jobExecutions: 1,
    startedAt: null,
    finishedAt: null,
  };
  const job = {
    id: "job-1",
    stackedJobName: "main",
    status: "RUNNING",
    executionId: "fn-exec-1",
    startedAt: null,
    finishedAt: null,
  };

  test("prints structured entries instead of the flat logs when both are present", () => {
    using stderr = captureStderr();

    printExecutionWithLogs({
      ...base,
      jobDetails: [
        {
          ...job,
          logs: "step 1",
          logEntries: [
            { message: "step 1", severity: "INFO", timestamp: new Date("2026-09-05T00:00:00Z") },
          ],
        },
      ],
    });

    const plain = stripAnsi(stderr.output);
    expect(plain).toContain("2026-09-05T00:00:00.000Z [INFO] step 1");
    expect(plain.match(/step 1/g)).toHaveLength(1);
  });

  test("falls back to the flat logs when no entries are present", () => {
    using stderr = captureStderr();

    printExecutionWithLogs({ ...base, jobDetails: [{ ...job, logs: "legacy line" }] });

    expect(stripAnsi(stderr.output)).toContain("    legacy line");
  });
});
