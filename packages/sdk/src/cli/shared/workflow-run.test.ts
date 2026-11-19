// oxlint-disable local/typed-operator-client-mock -- Untyped mocks; migrate them to mockOperatorClient() when editing them.
import { Code, ConnectError } from "@connectrpc/connect";
import { WorkflowExecution_Status } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { writeMetadataLabelsDirect } from "#/cli/commands/deploy/label";
import { awaitWorkflowRun, reclaimWorkflowRuns, startWorkflowRun } from "./workflow-run";
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
    createFunctionRegistry: vi.fn(async () => ({})),
    createWorkflowJobFunction: vi.fn(async () => ({ jobFunction: { version: 1n } })),
    createWorkflow: vi.fn(async () => ({ workflow: { id: "wf-1" } })),
    startWorkflow: vi.fn(async (_request: { arg: string }) => ({ executionId: "exec-1" })),
    getWorkflowExecution: vi.fn(async () => ({
      execution: {
        status: options.status ?? WorkflowExecution_Status.SUCCESS,
        jobExecutions: [{ executionId: "fn-1" }],
      },
    })),
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

interface Remote {
  name: string;
  labels: Record<string, string>;
  executions: WorkflowExecution_Status[];
}

function createSweepClient(remote: Remote[]) {
  const ids = new Map(remote.map((item, index) => [item.name, `wf-${index}`]));
  return {
    listWorkflows: vi.fn(async () => ({
      workflows: remote.map((item) => ({ id: ids.get(item.name), name: item.name })),
      nextPageToken: "",
    })),
    getMetadata: vi.fn(async ({ trn }: { trn: string }) => ({
      metadata: { labels: remote.find((item) => trn.endsWith(`:${item.name}`))?.labels ?? {} },
    })),
    listWorkflowExecutions: vi.fn(async ({ workflowName }: { workflowName: string }) => ({
      executions: (remote.find((item) => item.name === workflowName)?.executions ?? []).map(
        (status, index) => ({ id: `e${index}`, status }),
      ),
      nextPageToken: "",
    })),
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
});
