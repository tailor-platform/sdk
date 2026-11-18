import { Code, ConnectError } from "@connectrpc/connect";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { describe, expect, test } from "vitest";
import { captureStderr } from "#/cli/shared/test-helpers/capture-output";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { stripAnsi } from "#/cli/shared/test-helpers/strip-ansi";
import {
  getWorkflowWaitFailure,
  waitForWorkflowExecution,
  type WorkflowWaitOptions,
  type WorkflowWaitResult,
} from "./waiter";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { WorkflowExecutionSchema } from "@tailor-platform/tailor-proto/workflow_resource_pb";

function workflowExecution(
  status: WorkflowExecution_Status,
  jobStatuses: WorkflowJobExecution_Status[] = [],
): MessageInitShape<typeof WorkflowExecutionSchema> {
  return {
    id: "execution-1",
    workflowName: "my-workflow",
    status,
    jobExecutions: jobStatuses.map((jobStatus, index) => ({
      id: `job-${index + 1}`,
      kind: { case: "jobFunction" as const, value: { name: `job-${index + 1}` } },
      status: jobStatus,
      executionId: `function-${index + 1}`,
    })),
  };
}

function wait(
  client: WorkflowWaitOptions["client"],
  overrides: Partial<Parameters<typeof waitForWorkflowExecution>[0]> = {},
) {
  return waitForWorkflowExecution({
    client,
    workspaceId: "workspace-1",
    executionId: "execution-1",
    interval: 1,
    timeout: 100,
    until: "success",
    ...overrides,
  });
}

describe("waitForWorkflowExecution", () => {
  test("treats retry and pending states as transient until success", async () => {
    const client = mockOperatorClient({ getWorkflowExecution: {} });
    client.getWorkflowExecution
      .mockResolvedValueOnce({
        execution: workflowExecution(WorkflowExecution_Status.UNSPECIFIED),
      })
      .mockResolvedValueOnce({
        execution: workflowExecution(WorkflowExecution_Status.PENDING_RETRY),
      })
      .mockResolvedValueOnce({
        execution: workflowExecution(WorkflowExecution_Status.SUCCESS),
      });

    const result = await wait(client);

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
    const client = mockOperatorClient({
      getWorkflowExecution: {
        execution: workflowExecution(WorkflowExecution_Status.RUNNING, [
          WorkflowJobExecution_Status.WAITING,
        ]),
      },
    });

    const result = await wait(client, { until: "suspended" });

    expect(result.status).toBe("RUNNING");
    expect(result.statusClass).toBe("suspended");
    expect(getWorkflowWaitFailure(result, "suspended")).toBeUndefined();
  });

  test("names the active jobs by their job function while waiting", async () => {
    using stderr = captureStderr();
    const client = mockOperatorClient({
      getWorkflowExecution: {
        execution: workflowExecution(WorkflowExecution_Status.RUNNING, [
          WorkflowJobExecution_Status.SUCCESS,
          WorkflowJobExecution_Status.WAITING,
        ]),
      },
    });

    await wait(client, { until: "suspended", trackJobs: true, showProgress: true });

    expect(stripAnsi(stderr.output)).toContain("Job | job-2: RUNNING");
  });

  test("reports a new execution of a job function that is already listed by name", async () => {
    using stderr = captureStderr();
    const fetchJob = (id: string, status: WorkflowJobExecution_Status) => ({
      id,
      status,
      kind: { case: "jobFunction" as const, value: { name: "fetch" } },
    });
    const running = (
      jobExecutions: ReturnType<typeof fetchJob>[],
    ): MessageInitShape<typeof WorkflowExecutionSchema> => ({
      id: "execution-1",
      workflowName: "my-workflow",
      status: WorkflowExecution_Status.RUNNING,
      jobExecutions,
    });
    const client = mockOperatorClient({ getWorkflowExecution: {} });
    client.getWorkflowExecution
      .mockResolvedValueOnce({
        execution: running([fetchJob("job-1", WorkflowJobExecution_Status.RUNNING)]),
      })
      .mockResolvedValueOnce({
        execution: running([
          fetchJob("job-1", WorkflowJobExecution_Status.SUCCESS),
          fetchJob("job-2", WorkflowJobExecution_Status.WAITING),
        ]),
      });

    await wait(client, { until: "suspended", trackJobs: true, showProgress: true });

    expect(stripAnsi(stderr.output).match(/Job \| fetch: RUNNING/g)).toHaveLength(2);
  });

  test("stops at a canceled execution as a terminal failure", async () => {
    const client = mockOperatorClient({
      getWorkflowExecution: {
        execution: workflowExecution(WorkflowExecution_Status.CANCELED, [
          WorkflowJobExecution_Status.CANCELED,
        ]),
      },
    });

    const result = await wait(client);

    expect(result).toMatchObject({
      status: "CANCELED",
      statusClass: "failure",
      attempts: 1,
      timedOut: false,
    } satisfies Partial<WorkflowWaitResult>);
    expect(getWorkflowWaitFailure(result, "terminal")).toMatchObject({
      code: "WORKFLOW_EXECUTION_CANCELED",
      message: "Workflow execution 'execution-1' was canceled.",
      context: { executionId: "execution-1", status: "CANCELED" },
    });
  });

  test("retries retryable poll failures", async () => {
    const client = mockOperatorClient({ getWorkflowExecution: {} });
    client.getWorkflowExecution
      .mockRejectedValueOnce(new ConnectError("temporarily unavailable", Code.Unavailable))
      .mockResolvedValueOnce({
        execution: workflowExecution(WorkflowExecution_Status.SUCCESS),
      });

    const result = await wait(client);

    expect(result.status).toBe("SUCCESS");
    expect(result.attempts).toBe(2);
    expect(result.lastError).toBeNull();
  });

  test("returns timeout diagnostics with the last observed status", async () => {
    const client = mockOperatorClient({
      getWorkflowExecution: {
        execution: workflowExecution(WorkflowExecution_Status.PENDING),
      },
    });

    const result = await wait(client, { timeout: 5 });

    expect(result).toMatchObject({
      id: "execution-1",
      status: "PENDING",
      statusClass: "transient",
      timedOut: true,
      lastError: null,
    } satisfies Partial<WorkflowWaitResult>);
    expect(result.attempts).toBeGreaterThan(0);
    expect(getWorkflowWaitFailure(result, "success")).toMatchObject({
      code: "WORKFLOW_WAIT_TIMEOUT",
      message: expect.stringContaining("Timed out"),
      context: { executionId: "execution-1", status: "PENDING" },
    });
  });
});
