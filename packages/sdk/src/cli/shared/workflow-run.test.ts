// oxlint-disable local/typed-operator-client-mock -- Untyped mocks; migrate them to mockOperatorClient() when editing them.
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { WorkflowExecution_Status } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { writeMetadataLabelsDirect } from "#/cli/commands/deploy/label";
import { logger } from "./logger";
import {
  assertPollInterval,
  assertWorkflowArg,
  awaitWorkflowRun,
  reclaimFinishedWorkflowRuns,
  reclaimWorkflowRuns,
  startWorkflowRun,
  workflowRunHints,
} from "./workflow-run";
import { createRunId, workflowRunLabels } from "./workflow-run-labels";
import type { OperatorClient } from "./client";
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
  return {
    getAuthMachineUser: vi.fn(async () => ({ machineUser: {} })),
    createFunctionRegistry: vi.fn(async () => ({})),
    createWorkflowJobFunction: vi.fn(async () => ({ jobFunction: { version: 1n } })),
    createWorkflow: vi.fn(async () => ({ workflow: { id: "wf-1" } })),
    startWorkflow: vi.fn(async (_request: { arg: string }) => ({ executionId: "exec-1" })),
    getWorkflowExecution: vi.fn(
      async (_request?: unknown, _options?: { signal?: AbortSignal }) => ({
        execution: {
          status: options.status ?? WorkflowExecution_Status.SUCCESS,
          jobExecutions: [{ executionId: "fn-1" }],
        },
      }),
    ),
    getFunctionExecution: vi.fn(async () => ({
      execution: { logEntries: [{ message: "hello" }], result: options.result ?? '{"ok":true}' },
    })),
    deleteWorkflow: vi.fn(async () => ({})),
    deleteWorkflowJobFunction: vi.fn(async () => ({})),
    deleteFunctionRegistry: vi.fn(async () => ({})),
  };
}

const asClient = (client: object) => client as unknown as OperatorClient;

describe("startWorkflowRun", () => {
  test("registers the script under the run's name and starts it with the argument", async () => {
    const client = createClient();
    const started = await startWorkflowRun({
      client: asClient(client),
      workspaceId: "ws",
      runId,
      kind: "script",
      code: "export async function main() {}",
      description: "workflow run",
      invoker,
      arg: { n: 1 },
    });

    expect(started).toEqual({
      runId,
      name: `tmp-${runId}`,
      workflowId: "wf-1",
      executionId: "exec-1",
    });
    expect(client.startWorkflow.mock.calls[0]?.[0].arg).toBe('{"n":1}');
  });

  test("labels the function, job function and workflow with the run key and no owner", async () => {
    const client = createClient();
    await startWorkflowRun({
      client: asClient(client),
      workspaceId: "ws",
      runId,
      kind: "job",
      code: "",
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
      expect(write.labels).toEqual(workflowRunLabels({ kind: "job", runId }));
    }
  });

  test("removes what it registered when the start is refused", async () => {
    const client = createClient();
    client.startWorkflow.mockRejectedValueOnce(new ConnectError("denied", Code.PermissionDenied));

    await expect(
      startWorkflowRun({
        client: asClient(client),
        workspaceId: "ws",
        runId,
        kind: "script",
        code: "",
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
        client: asClient(client),
        workspaceId: "ws",
        runId,
        kind: "script",
        code: "",
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
        client: asClient(client),
        workspaceId: "ws",
        runId,
        kind: "script",
        code: "",
        description: "d",
        invoker,
        arg: undefined,
      }),
    ).rejects.toThrow(/runner/);
    expect(client.createFunctionRegistry).not.toHaveBeenCalled();
    expect(client.startWorkflow).not.toHaveBeenCalled();
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
        client: asClient(client),
        workspaceId: "ws",
        runId,
        kind: "script",
        code: "",
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

const started = { runId, name: `tmp-${runId}`, workflowId: "wf-1", executionId: "exec-1" };

describe("awaitWorkflowRun", () => {
  test("reports the script's result and removes the resources once it finishes", async () => {
    const client = createClient();
    const outcome = await awaitWorkflowRun({
      client: asClient(client),
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome).toEqual({
      state: "finished",
      result: { success: true, logs: "hello", result: '{"ok":true}' },
    });
    expect(client.deleteWorkflow).toHaveBeenCalledOnce();
    expect(client.deleteFunctionRegistry).toHaveBeenCalledOnce();
  });

  test("leaves the resources in place when the wait times out", async () => {
    const client = createClient({ status: WorkflowExecution_Status.RUNNING });
    const outcome = await awaitWorkflowRun({
      client: asClient(client),
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

describe("awaitWorkflowRun deadline", () => {
  test("stops waiting at the deadline even when every poll fails transiently", async () => {
    const client = createClient();
    client.getWorkflowExecution.mockRejectedValue(new ConnectError("down", Code.Unavailable));

    const outcome = await awaitWorkflowRun({
      client: asClient(client),
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
      (_request?: unknown, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new ConnectError("canceled", Code.Canceled)),
          );
        }) as never,
    );

    const outcome = await awaitWorkflowRun({
      client: asClient(client),
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
      client: asClient(client),
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
  name: string;
  labels: Record<string, string>;
  executions: WorkflowExecution_Status[];
  /** When the platform created the workflow */
  createdAt?: Date;
  /** When the executions finished */
  finishedAt?: Date;
}

function createSweepClient(remote: Remote[]) {
  const ids = new Map(remote.map((item, index) => [item.name, `wf-${index}`]));
  return {
    listWorkflows: vi.fn(async () => ({
      workflows: remote.map((item) => ({
        id: ids.get(item.name),
        name: item.name,
        createdAt: item.createdAt && timestampFromDate(item.createdAt),
      })),
      nextPageToken: "",
    })),
    getMetadata: vi.fn(async ({ trn }: { trn: string }) => ({
      metadata: { labels: remote.find((item) => trn.endsWith(`:${item.name}`))?.labels ?? {} },
    })),
    listWorkflowExecutions: vi.fn(async ({ workflowName }: { workflowName: string }) => {
      const item = remote.find((candidate) => candidate.name === workflowName);
      return {
        executions: (item?.executions ?? []).map((status, index) => ({
          id: `e${index}`,
          status,
          finishedAt: item?.finishedAt && timestampFromDate(item.finishedAt),
        })),
        nextPageToken: "",
      };
    }),
    deleteWorkflow: vi.fn(async (_request: { workflowId: string }) => ({})),
    deleteWorkflowJobFunction: vi.fn(async () => ({})),
    deleteFunctionRegistry: vi.fn(async () => ({})),
  };
}

describe("reclaimWorkflowRuns", () => {
  const old = new Date(now.getTime() + 60 * 60 * 1000);
  const run = (id: string) => workflowRunLabels({ kind: "script", runId: id });

  test("removes the resources of runs that finished", async () => {
    const client = createSweepClient([
      { name: `tmp-${runId}`, labels: run(runId), executions: [WorkflowExecution_Status.SUCCESS] },
    ]);
    await reclaimWorkflowRuns({ client: asClient(client), workspaceId: "ws", now: old });

    expect(client.deleteWorkflow.mock.calls[0]?.[0].workflowId).toBe("wf-0");
    expect(client.deleteFunctionRegistry).toHaveBeenCalledWith({
      workspaceId: "ws",
      name: `tmp-${runId}`,
    });
  });

  test("keeps a run that is still executing", async () => {
    const client = createSweepClient([
      { name: `tmp-${runId}`, labels: run(runId), executions: [WorkflowExecution_Status.RUNNING] },
    ]);
    await reclaimWorkflowRuns({ client: asClient(client), workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("keeps a run created moments ago that has not started yet", async () => {
    const client = createSweepClient([
      { name: `tmp-${runId}`, labels: run(runId), executions: [] },
    ]);
    await reclaimWorkflowRuns({
      client: asClient(client),
      workspaceId: "ws",
      now: new Date(now.getTime() + 5000),
    });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("removes a run that never started once it is old enough", async () => {
    const client = createSweepClient([
      { name: `tmp-${runId}`, labels: run(runId), executions: [] },
    ]);
    await reclaimWorkflowRuns({ client: asClient(client), workspaceId: "ws", now: old });

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
    await reclaimWorkflowRuns({ client: asClient(client), workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("leaves a workflow alone when its name is not the one a run gives its resources", async () => {
    const client = createSweepClient([
      { name: "orders", labels: run(runId), executions: [WorkflowExecution_Status.SUCCESS] },
    ]);
    await reclaimWorkflowRuns({ client: asClient(client), workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });

  test("leaves a workflow alone when an app owns it, whatever else it is labeled", async () => {
    const client = createSweepClient([
      {
        name: `tmp-${runId}`,
        labels: { ...run(runId), "sdk-name": "app" },
        executions: [WorkflowExecution_Status.SUCCESS],
      },
    ]);
    await reclaimWorkflowRuns({ client: asClient(client), workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("does not report a run as removed when its removal failed", async () => {
    const client = createSweepClient([
      { name: `tmp-${runId}`, labels: run(runId), executions: [WorkflowExecution_Status.SUCCESS] },
    ]);
    client.deleteWorkflow.mockRejectedValueOnce(new ConnectError("boom", Code.Unavailable));

    const removed = await reclaimWorkflowRuns({
      client: asClient(client),
      workspaceId: "ws",
      now: old,
    });

    expect(removed).toEqual([]);
  });

  test("keeps a run that finished moments ago, so its waiter can read the outcome", async () => {
    const client = createSweepClient([
      {
        name: `tmp-${runId}`,
        labels: run(runId),
        executions: [WorkflowExecution_Status.SUCCESS],
        finishedAt: new Date(old.getTime() - 10_000),
      },
    ]);
    await reclaimWorkflowRuns({ client: asClient(client), workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("keeps a run for the whole window a waiter polling at the longest allowed interval may need", async () => {
    const client = createSweepClient([
      {
        name: `tmp-${runId}`,
        labels: run(runId),
        executions: [WorkflowExecution_Status.SUCCESS],
        finishedAt: new Date(old.getTime() - 3 * 60_000),
      },
    ]);
    await reclaimWorkflowRuns({ client: asClient(client), workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("removes a run that finished long ago", async () => {
    const client = createSweepClient([
      {
        name: `tmp-${runId}`,
        labels: run(runId),
        executions: [WorkflowExecution_Status.SUCCESS],
        finishedAt: new Date(old.getTime() - 10 * 60_000),
      },
    ]);
    await reclaimWorkflowRuns({ client: asClient(client), workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).toHaveBeenCalledOnce();
  });

  test("removes a run that finished moments ago when asked to ignore the grace", async () => {
    const client = createSweepClient([
      {
        name: `tmp-${runId}`,
        labels: run(runId),
        executions: [WorkflowExecution_Status.SUCCESS],
        finishedAt: new Date(old.getTime() - 10_000),
      },
    ]);
    await reclaimWorkflowRuns({
      client: asClient(client),
      workspaceId: "ws",
      now: old,
      ignoreFinishedGrace: true,
    });

    expect(client.deleteWorkflow).toHaveBeenCalledOnce();
  });

  test("measures the wait for a run that has not started from the workflow's creation, not the run id", async () => {
    const client = createSweepClient([
      {
        name: `tmp-${runId}`,
        labels: run(runId),
        executions: [],
        createdAt: new Date(old.getTime() - 5000),
      },
    ]);
    await reclaimWorkflowRuns({ client: asClient(client), workspaceId: "ws", now: old });

    expect(client.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("reports a failed removal only to the debug output when asked to stay quiet", async () => {
    vi.mocked(logger.warn).mockClear();
    const client = createSweepClient([
      { name: `tmp-${runId}`, labels: run(runId), executions: [WorkflowExecution_Status.SUCCESS] },
    ]);
    client.deleteWorkflow.mockRejectedValueOnce(new ConnectError("boom", Code.Unavailable));

    await reclaimWorkflowRuns({
      client: asClient(client),
      workspaceId: "ws",
      now: old,
      quiet: true,
    });

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining(`tmp-${runId}`));
  });

  test("skips a workflow whose metadata is gone and still sweeps the others", async () => {
    const other = createRunId(now, "bbbbbb");
    const client = createSweepClient([
      { name: `tmp-${runId}`, labels: run(runId), executions: [WorkflowExecution_Status.SUCCESS] },
      { name: `tmp-${other}`, labels: run(other), executions: [WorkflowExecution_Status.SUCCESS] },
    ]);
    client.getMetadata.mockRejectedValueOnce(new ConnectError("gone", Code.NotFound));

    const removed = await reclaimWorkflowRuns({
      client: asClient(client),
      workspaceId: "ws",
      now: old,
    });

    expect(removed).toEqual([`tmp-${other}`]);
  });

  test("does not read the labels of workflows whose name is not a run's", async () => {
    const client = createSweepClient([
      { name: "nightly", labels: { "sdk-name": "app" }, executions: [] },
    ]);
    await reclaimWorkflowRuns({ client: asClient(client), workspaceId: "ws", now: old });

    expect(client.getMetadata).not.toHaveBeenCalled();
  });
});

describe("reclaimFinishedWorkflowRuns", () => {
  const old = new Date(now.getTime() + 60 * 60 * 1000);

  test("removes finished runs and reports how many", async () => {
    const client = createSweepClient([
      {
        name: `tmp-${runId}`,
        labels: workflowRunLabels({ kind: "script", runId }),
        executions: [WorkflowExecution_Status.SUCCESS],
      },
    ]);

    const removed = await reclaimFinishedWorkflowRuns({
      client: asClient(client),
      workspaceId: "ws",
      now: old,
    });

    expect(removed).toBe(1);
  });

  test("does not fail the caller when the sweep itself fails", async () => {
    const client = createSweepClient([]);
    client.listWorkflows.mockRejectedValueOnce(new ConnectError("down", Code.Unavailable));

    await expect(
      reclaimFinishedWorkflowRuns({ client: asClient(client), workspaceId: "ws", now: old }),
    ).resolves.toBe(0);
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
    expect(hints.cleanup).toContain("tailor workflow run --cleanup");
    expect(hints.cleanup).toContain("ws-1");
    expect(hints.cleanup).toContain("staging");
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
