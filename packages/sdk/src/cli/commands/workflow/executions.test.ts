import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { getWorkflowExecution } from "./executions";
import type { WorkflowExecution } from "@tailor-platform/tailor-proto/workflow_resource_pb";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

function execution(status: WorkflowExecution_Status): WorkflowExecution {
  return {
    id: "execution-1",
    workflowName: "my-workflow",
    status,
    jobExecutions: [],
  } as unknown as WorkflowExecution;
}

describe("getWorkflowExecution", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();

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

  test("reads job logs from the structured entries of each function execution", async () => {
    const getFunctionExecution = vi.fn().mockResolvedValue({
      execution: {
        logEntries: [{ message: "first line" }, { message: "second line" }],
        result: "",
      },
    });
    vi.mocked(initOperatorClient).mockResolvedValue({
      getWorkflowExecution: vi.fn().mockResolvedValue({
        execution: {
          ...execution(WorkflowExecution_Status.SUCCESS),
          jobExecutions: [
            {
              id: "job-1",
              stackedJobName: "main",
              status: WorkflowJobExecution_Status.SUCCESS,
              executionId: "function-execution-1",
            },
          ],
        },
      }),
      getFunctionExecution,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

    const { execution: result } = await getWorkflowExecution({
      executionId: "execution-1",
      logs: true,
    });

    expect(getFunctionExecution).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      executionId: "function-execution-1",
    });
    expect(result.jobDetails?.[0]?.logs).toBe("first line\nsecond line");
  });
});
