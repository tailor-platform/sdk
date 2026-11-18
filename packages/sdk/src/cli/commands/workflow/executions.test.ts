// oxlint-disable local/typed-operator-client-mock -- Untyped mocks; migrate them to mockOperatorClient() when editing them.
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import {
  FunctionExecution_Status,
  FunctionExecutionSchema,
  FunctionLogSeverity,
  FunctionLogSource,
} from "@tailor-platform/tailor-proto/function_resource_pb";
import { PageDirection } from "@tailor-platform/tailor-proto/resource_pb";
import {
  WorkflowExecution_Status,
  WorkflowExecutionSchema,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { stripAnsi } from "#/cli/shared/test-helpers/strip-ansi";
import {
  executionsCommand,
  getWorkflowExecution,
  listWorkflowExecutions,
  printExecutionWithLogs,
} from "./executions";
import type { ListWorkflowExecutionsRequest } from "@tailor-platform/tailor-proto/workflow_pb";
import type { WorkflowExecution } from "@tailor-platform/tailor-proto/workflow_resource_pb";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

aroundEach(async (runTest) => {
  vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
  vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
  await runTest();
});

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
  kind: { case: "jobFunction", value: { name: "main" } },
  position: { parentWorkflowJobExecutionId: "", depth: 0 },
  status: WorkflowJobExecution_Status.RUNNING,
  executionId: "fn-exec-1",
} as unknown as WorkflowExecution["jobExecutions"][number];

describe("getWorkflowExecution", () => {
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
            source: FunctionLogSource.USER,
          },
          {
            message: "runs close to the limit",
            severity: FunctionLogSeverity.WARNING,
            timestamp: timestampFromDate(new Date("2026-09-05T00:00:01.000Z")),
            source: FunctionLogSource.PLATFORM,
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
        kind: { type: "jobFunction", name: "main" },
        position: { parentJobExecutionId: null, callIndex: null, branchIndex: null, depth: 0 },
        logs: "step 1\nruns close to the limit",
        result: undefined,
        logEntries: [
          {
            message: "step 1",
            severity: "INFO",
            timestamp: new Date("2026-09-05T00:00:00.000Z"),
            source: "USER",
          },
          {
            message: "runs close to the limit",
            severity: "WARNING",
            timestamp: new Date("2026-09-05T00:00:01.000Z"),
            source: "PLATFORM",
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
          result: "1",
        }),
      }),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

    const { execution: detail } = await getWorkflowExecution({
      executionId: "execution-1",
      logs: true,
    });

    expect(detail.jobDetails?.[0]).toMatchObject({ logs: undefined, result: "1" });
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

    expect(detail.jobDetails).toEqual([
      expect.objectContaining({ kind: { type: "jobFunction", name: "main" } }),
    ]);
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

    expect(detail.jobDetails).toEqual([
      expect.objectContaining({ kind: { type: "jobFunction", name: "main" } }),
    ]);
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
    kind: { type: "jobFunction" as const, name: "main" },
    position: null,
    status: "RUNNING",
    executionId: "fn-exec-1",
    startedAt: null,
    finishedAt: null,
  };

  test("prints each structured entry once", () => {
    using stderr = captureStderr();

    printExecutionWithLogs({
      ...base,
      jobDetails: [
        {
          ...job,
          logs: "step 1\n\n    continued\n",
          logEntries: [
            {
              message: "step 1\n\n    continued\n",
              severity: "INFO",
              timestamp: new Date("2026-09-05T00:00:00Z"),
              source: "USER",
            },
          ],
        },
      ],
    });

    const plain = stripAnsi(stderr.output);
    expect(plain).toContain("--- main ---\n  ID: job-1\n");
    expect(plain).toContain(
      "    2026-09-05T00:00:00.000Z [INFO] step 1\n    \n        continued\n    \n",
    );
    expect(plain.match(/step 1/g)).toHaveLength(1);
  });

  test("heads a job of an unknown kind with its id alone", () => {
    using stderr = captureStderr();

    printExecutionWithLogs({
      ...base,
      jobDetails: [{ ...job, id: "job-9", kind: { type: "unknown" } }],
    });

    expect(stripAnsi(stderr.output)).toContain("--- job-9 ---\n  Status: RUNNING\n");
  });

  test("marks entries the Platform wrote apart from the job's own output", () => {
    using stderr = captureStderr();

    printExecutionWithLogs({
      ...base,
      jobDetails: [
        {
          ...job,
          logs: "step 1\nruns close to the limit\nmove long work elsewhere",
          logEntries: [
            {
              message: "step 1",
              severity: "INFO",
              timestamp: new Date("2026-09-05T00:00:00Z"),
              source: "USER",
            },
            {
              message: "runs close to the limit\nmove long work elsewhere",
              severity: "WARNING",
              timestamp: new Date("2026-09-05T00:00:01Z"),
              source: "PLATFORM",
            },
          ],
        },
      ],
    });

    const plain = stripAnsi(stderr.output);
    expect(plain).toContain("2026-09-05T00:00:00.000Z [INFO] step 1\n");
    expect(plain).toContain(
      "    2026-09-05T00:00:01.000Z [WARNING] [PLATFORM] runs close to the limit\n    [PLATFORM] move long work elsewhere\n",
    );
  });
});

interface ExecutionFixture {
  id: string;
  startedAt?: string;
  finishedAt?: string;
}

function mockWorkflowClient(
  executionsByWorkflow: Record<string, ExecutionFixture[] | ConnectError>,
) {
  const listWorkflows = vi.fn(async () => ({
    workflows: Object.keys(executionsByWorkflow).map((name) => ({ name })),
    nextPageToken: "",
  }));
  const listWorkflowExecutions = vi.fn(async (request: Partial<ListWorkflowExecutionsRequest>) => {
    const workflowName = request.workflowName ?? "";
    if (workflowName === "") {
      throw new ConnectError(
        "validation error: workflow_name: does not match regex pattern",
        Code.InvalidArgument,
      );
    }
    const created = executionsByWorkflow[workflowName];
    if (created === undefined) {
      throw new ConnectError(`workflow '${workflowName}' not found`, Code.NotFound);
    }
    if (created instanceof ConnectError) throw created;
    const ordered = request.pageDirection === PageDirection.ASC ? created : created.toReversed();
    const offset = Number(request.pageToken || 0);
    const end = offset + (request.pageSize || ordered.length);
    return {
      executions: ordered.slice(offset, end).map(({ id, startedAt, finishedAt }) =>
        create(WorkflowExecutionSchema, {
          id,
          workflowName,
          status: startedAt
            ? WorkflowExecution_Status.SUCCESS
            : finishedAt
              ? WorkflowExecution_Status.CANCELED
              : WorkflowExecution_Status.PENDING,
          startedAt: startedAt ? timestampFromDate(new Date(startedAt)) : undefined,
          finishedAt: finishedAt ? timestampFromDate(new Date(finishedAt)) : undefined,
        }),
      ),
      nextPageToken: end < ordered.length ? String(end) : "",
    };
  });
  vi.mocked(initOperatorClient).mockResolvedValue({
    listWorkflows,
    listWorkflowExecutions,
  } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
  return { listWorkflows, listWorkflowExecutions };
}

// Each list is in creation order, oldest first.
const executionsByWorkflow = {
  "wf-a": [
    { id: "a1", startedAt: "2026-11-01T10:30:00Z" },
    { id: "a2", startedAt: "2026-11-01T10:20:00Z" },
    { id: "a3" },
  ],
  "wf-b": [
    { id: "b1", startedAt: "2026-11-01T10:10:00Z" },
    { id: "b2", startedAt: "2026-11-01T10:25:00Z" },
  ],
  "wf-empty": [],
};

describe("listWorkflowExecutions", () => {
  test("lists the executions of every workflow when no workflow is given", async () => {
    const { listWorkflowExecutions: listRequest } = mockWorkflowClient(executionsByWorkflow);

    const executions = await listWorkflowExecutions();

    expect(executions.map((e) => e.id)).toEqual(["a3", "b2", "a2", "a1", "b1"]);
    expect(new Set(listRequest.mock.calls.map(([request]) => request.workflowName))).toEqual(
      new Set(["wf-a", "wf-b", "wf-empty"]),
    );
  });

  test("cuts the merged executions at the limit", async () => {
    const { listWorkflowExecutions: listRequest } = mockWorkflowClient(executionsByWorkflow);

    const executions = await listWorkflowExecutions({ limit: 2 });

    expect(executions.map((e) => e.id)).toEqual(["a3", "b2"]);
    for (const [request] of listRequest.mock.calls) {
      expect(request.pageSize).toBeLessThanOrEqual(2);
    }
  });

  test.each<{
    name: string;
    workflows: Record<string, ExecutionFixture[]>;
    limit?: number;
    expected: string[];
  }>([
    {
      name: "the oldest executions first across workflows",
      workflows: executionsByWorkflow,
      expected: ["b1", "b2", "a1", "a2", "a3"],
    },
    {
      name: "an execution that has neither started nor finished after the others",
      workflows: {
        "wf-queued": [{ id: "q1" }],
        "wf-a": [{ id: "a1", startedAt: "2026-11-01T10:30:00Z" }],
      },
      limit: 1,
      expected: ["a1"],
    },
    {
      name: "an execution that finished without starting by its finish time",
      workflows: {
        "wf-a": [
          { id: "a-canceled", finishedAt: "2026-11-01T08:30:00Z" },
          { id: "a-early", startedAt: "2026-11-01T09:00:00Z" },
        ],
        "wf-b": [
          { id: "b1", startedAt: "2026-11-01T10:00:00Z" },
          { id: "b2", startedAt: "2026-11-01T11:00:00Z" },
        ],
        "wf-c": [
          { id: "c1", startedAt: "2026-11-01T08:00:00Z", finishedAt: "2026-11-01T09:30:00Z" },
        ],
      },
      limit: 3,
      expected: ["c1", "a-canceled", "a-early"],
    },
  ])("lists $name with asc order", async ({ workflows, limit, expected }) => {
    mockWorkflowClient(workflows);

    const executions = await listWorkflowExecutions({ order: "asc", limit });

    expect(executions.map((e) => e.id)).toEqual(expected);
  });

  test("sends the status filter with each workflow's request", async () => {
    const { listWorkflowExecutions: listRequest } = mockWorkflowClient(executionsByWorkflow);

    await listWorkflowExecutions({ status: "RUNNING" });

    expect(listRequest).toHaveBeenCalledTimes(3);
    for (const [request] of listRequest.mock.calls) {
      expect(request.filter?.and[0]?.condition).toMatchObject({
        field: "status",
        value: { kind: { case: "numberValue", value: WorkflowExecution_Status.RUNNING } },
      });
    }
  });

  test("skips a workflow that is deleted while listing", async () => {
    mockWorkflowClient({
      ...executionsByWorkflow,
      "wf-gone": new ConnectError("workflow 'wf-gone' not found", Code.NotFound),
    });

    const executions = await listWorkflowExecutions();

    expect(executions.map((e) => e.id)).toEqual(["a3", "b2", "a2", "a1", "b1"]);
  });

  test("fails when a workflow's executions cannot be listed", async () => {
    mockWorkflowClient({
      ...executionsByWorkflow,
      "wf-b": new ConnectError("try later", Code.Unavailable),
    });

    await expect(listWorkflowExecutions()).rejects.toThrow("try later");
  });

  test("queries only the given workflow", async () => {
    const { listWorkflows, listWorkflowExecutions: listRequest } =
      mockWorkflowClient(executionsByWorkflow);

    const executions = await listWorkflowExecutions({ workflow: { name: "wf-a" } });

    expect(executions.map((e) => e.id)).toEqual(["a3", "a2", "a1"]);
    expect(listWorkflows).not.toHaveBeenCalled();
    expect(listRequest.mock.calls.map(([request]) => request.workflowName)).toEqual(["wf-a"]);
  });
});

describe("executionsCommand", () => {
  test("lists the executions of every workflow without --workflow-name", async () => {
    mockWorkflowClient(executionsByWorkflow);
    using stdout = captureStdout();
    using _json = jsonMode();

    const result = await runCommand(executionsCommand, []);

    expect(result.success).toBe(true);
    expect((JSON.parse(stdout.output) as { id: string }[]).map((e) => e.id)).toEqual([
      "a3",
      "b2",
      "a2",
      "a1",
      "b1",
    ]);
  });

  test("rejects a workflow name the platform rejects", async () => {
    const result = await runCommand(executionsCommand, ["--workflow-name", "My_Workflow"]);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain(
      "must be 3-63 lowercase letters, digits, or hyphens, starting and ending with a letter or digit",
    );
  });
});
