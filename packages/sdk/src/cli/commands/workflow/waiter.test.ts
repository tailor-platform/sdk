import { Code, ConnectError } from "@connectrpc/connect";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-proto/tailor/v1/workflow_resource_pb";
import { describe, expect, test, vi } from "vitest";
import {
  getWorkflowWaitFailureMessage,
  waitForWorkflowExecution,
  type WorkflowWaitResult,
} from "./waiter";
import type {
  WorkflowExecution,
  WorkflowJobExecution,
} from "@tailor-proto/tailor/v1/workflow_resource_pb";

function workflowExecution(
  status: WorkflowExecution_Status,
  jobStatuses: WorkflowJobExecution_Status[] = [],
): WorkflowExecution {
  return {
    id: "execution-1",
    workflowName: "my-workflow",
    status,
    jobExecutions: jobStatuses.map(
      (jobStatus, index) =>
        ({
          id: `job-${index + 1}`,
          stackedJobName: `job-${index + 1}`,
          status: jobStatus,
          executionId: `function-${index + 1}`,
        }) as WorkflowJobExecution,
    ),
  } as WorkflowExecution;
}

function workflowClient(
  getWorkflowExecution: ReturnType<typeof vi.fn>,
): Parameters<typeof waitForWorkflowExecution>[0]["client"] {
  return {
    getWorkflowExecution,
  } as unknown as Parameters<typeof waitForWorkflowExecution>[0]["client"];
}

describe("waitForWorkflowExecution", () => {
  test("treats retry and pending states as transient until success", async () => {
    const getWorkflowExecution = vi
      .fn()
      .mockResolvedValueOnce({
        execution: workflowExecution(WorkflowExecution_Status.UNSPECIFIED),
      })
      .mockResolvedValueOnce({
        execution: workflowExecution(WorkflowExecution_Status.PENDING_RETRY),
      })
      .mockResolvedValueOnce({
        execution: workflowExecution(WorkflowExecution_Status.SUCCESS),
      });

    const result = await waitForWorkflowExecution({
      client: workflowClient(getWorkflowExecution),
      workspaceId: "workspace-1",
      executionId: "execution-1",
      interval: 1,
      timeout: 100,
      until: "success",
    });

    expect(result).toMatchObject({
      id: "execution-1",
      status: "SUCCESS",
      statusClass: "success",
      attempts: 3,
      timedOut: false,
      lastError: null,
    } satisfies Partial<WorkflowWaitResult>);
  });

  test("can wait for a job-level suspended state", async () => {
    const getWorkflowExecution = vi.fn().mockResolvedValue({
      execution: workflowExecution(WorkflowExecution_Status.RUNNING, [
        WorkflowJobExecution_Status.WAITING,
      ]),
    });

    const result = await waitForWorkflowExecution({
      client: workflowClient(getWorkflowExecution),
      workspaceId: "workspace-1",
      executionId: "execution-1",
      interval: 1,
      timeout: 100,
      until: "suspended",
    });

    expect(result.status).toBe("RUNNING");
    expect(result.statusClass).toBe("suspended");
    expect(getWorkflowWaitFailureMessage(result, "suspended")).toBeUndefined();
  });

  test("retries retryable poll failures", async () => {
    const getWorkflowExecution = vi
      .fn()
      .mockRejectedValueOnce(new ConnectError("temporarily unavailable", Code.Unavailable))
      .mockResolvedValueOnce({
        execution: workflowExecution(WorkflowExecution_Status.SUCCESS),
      });

    const result = await waitForWorkflowExecution({
      client: workflowClient(getWorkflowExecution),
      workspaceId: "workspace-1",
      executionId: "execution-1",
      interval: 1,
      timeout: 100,
      until: "success",
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.attempts).toBe(2);
    expect(result.lastError).toBeNull();
  });

  test("returns timeout diagnostics with the last observed status", async () => {
    const getWorkflowExecution = vi.fn().mockResolvedValue({
      execution: workflowExecution(WorkflowExecution_Status.PENDING),
    });

    const result = await waitForWorkflowExecution({
      client: workflowClient(getWorkflowExecution),
      workspaceId: "workspace-1",
      executionId: "execution-1",
      interval: 1,
      timeout: 5,
      until: "success",
    });

    expect(result).toMatchObject({
      id: "execution-1",
      status: "PENDING",
      statusClass: "transient",
      timedOut: true,
      lastError: null,
    } satisfies Partial<WorkflowWaitResult>);
    expect(result.attempts).toBeGreaterThan(0);
    expect(getWorkflowWaitFailureMessage(result, "success")).toContain("Timed out");
  });
});
