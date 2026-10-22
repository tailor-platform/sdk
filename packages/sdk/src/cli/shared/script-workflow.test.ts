import { Code, ConnectError } from "@connectrpc/connect";
import { WorkflowExecution_Status } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { describe, expect, test, vi } from "vitest";
import { writeMetadataLabelsDirect } from "#/cli/commands/deploy/label";
import { logger } from "./logger";
import {
  inspectScriptWorkflow,
  withKeptScriptWorkflow,
  withScriptWorkflow,
} from "./script-workflow";
import type { OperatorClient } from "./client";
import type { ScriptInvoker } from "./script-executor";

vi.mock("#/cli/shared/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), log: vi.fn() },
  styles: { bold: (s: string) => s },
  redactSecrets: (s: string) => s,
}));

vi.mock("#/cli/commands/deploy/label", () => ({
  resourceTrn: (workspaceId: string, kind: string, name: string) =>
    `trn:v1:workspace:${workspaceId}:${kind}:${name}`,
  writeMetadataLabelsDirect: vi.fn(),
  buildMetaRequest: vi.fn(async (params: unknown) => params),
}));

const invoker = { namespace: "auth", machineUserName: "seeder" } as ScriptInvoker;

interface MockClientOptions {
  status?: WorkflowExecution_Status;
  logs?: string[];
  result?: string;
  errorMessage?: string;
  /** Workflow left behind by an interrupted earlier run. */
  leftoverWorkflowId?: string;
  /** Labels recorded on the workflow. */
  workflowLabels?: Record<string, string>;
  /** Executions of the workflow, newest first. */
  executions?: { id: string; status: WorkflowExecution_Status }[];
}

function createMockClient(options: MockClientOptions = {}) {
  const calls: string[] = [];
  const record = <T>(name: string, value: T) => {
    calls.push(name);
    return Promise.resolve(value);
  };
  const client = {
    getWorkflowByName: vi.fn(() => {
      calls.push("getWorkflowByName");
      if (options.leftoverWorkflowId === undefined) {
        return Promise.reject(new ConnectError("not found", Code.NotFound));
      }
      return Promise.resolve({ workflow: { id: options.leftoverWorkflowId } });
    }),
    getMetadata: vi.fn(() =>
      Promise.resolve({ metadata: { labels: options.workflowLabels ?? {} } }),
    ),
    listWorkflowExecutions: vi.fn(() =>
      Promise.resolve({ executions: options.executions ?? [], nextPageToken: "" }),
    ),
    deleteWorkflow: vi.fn(() => record("deleteWorkflow", {})),
    deleteWorkflowJobFunction: vi.fn(() => record("deleteWorkflowJobFunction", {})),
    deleteFunctionRegistry: vi.fn(() => record("deleteFunctionRegistry", {})),
    createFunctionRegistry: vi.fn(() => record("createFunctionRegistry", {})),
    createWorkflowJobFunction: vi.fn(() =>
      record("createWorkflowJobFunction", { jobFunction: { version: 1n } }),
    ),
    createWorkflow: vi.fn(() => record("createWorkflow", { workflow: { id: "wf-1" } })),
    startWorkflow: vi.fn((_request: { workflowId: string; authInvoker: unknown; arg: string }) =>
      record("startWorkflow", { executionId: "exec-1" }),
    ),
    getWorkflowExecution: vi.fn(() =>
      Promise.resolve({
        execution: {
          status: options.status ?? WorkflowExecution_Status.SUCCESS,
          jobExecutions: [{ executionId: "fn-1" }],
        },
      }),
    ),
    getFunctionExecution: vi.fn(() =>
      Promise.resolve({
        execution: {
          logEntries: (options.logs ?? []).map((message) => ({ message })),
          error: options.errorMessage ? { message: options.errorMessage } : undefined,
          result: options.result ?? "",
        },
      }),
    ),
  };
  return { client: client as unknown as OperatorClient, mocks: client, calls };
}

const baseOptions = {
  workspaceId: "ws",
  name: "tailordb-seed--tailordb",
  description: "Temporary function for seeding",
  code: "export async function main() {}",
  invoker,
  appName: "my-app",
  leftoverNote: "It is removed by the next run.",
  pollIntervalMs: 1,
};

describe("withScriptWorkflow", () => {
  test("registers the script once and starts it once per argument with the argument as JSON", async () => {
    const { client, mocks } = createMockClient({ result: '{"success":true}' });

    await withScriptWorkflow({ ...baseOptions, client }, async (run) => {
      await run({ chunk: 1 });
      await run({ chunk: 2 });
    });

    expect(mocks.createFunctionRegistry).toHaveBeenCalledTimes(1);
    expect(mocks.createWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.startWorkflow.mock.calls.map(([request]) => request.arg)).toEqual([
      '{"chunk":1}',
      '{"chunk":2}',
    ]);
    expect(mocks.startWorkflow.mock.calls[0]?.[0]).toMatchObject({
      workflowId: "wf-1",
      authInvoker: invoker,
    });
  });

  test("returns the logs and result of the job when the workflow succeeds", async () => {
    const { client } = createMockClient({
      logs: ["[tailordb] User: 1/1"],
      result: '{"success":true,"processed":{}}',
    });

    const outcome = await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(outcome).toEqual({
      success: true,
      logs: "[tailordb] User: 1/1",
      result: '{"success":true,"processed":{}}',
    });
  });

  test("reports the job's error message when the workflow fails", async () => {
    const { client } = createMockClient({
      status: WorkflowExecution_Status.FAILED,
      errorMessage: "Query cancelled due to runtime timeout",
    });

    const outcome = await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(outcome).toMatchObject({
      success: false,
      error: "Query cancelled due to runtime timeout",
    });
  });

  test("removes the workflow, job function and function after the callback", async () => {
    const { client, calls } = createMockClient();

    await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(calls.slice(-3)).toEqual([
      "deleteWorkflow",
      "deleteWorkflowJobFunction",
      "deleteFunctionRegistry",
    ]);
  });

  test("removes the resources and rethrows when the callback throws", async () => {
    const { client, mocks, calls } = createMockClient();

    await expect(
      withScriptWorkflow({ ...baseOptions, client }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(mocks.deleteWorkflow).toHaveBeenCalledWith({ workspaceId: "ws", workflowId: "wf-1" });
    expect(calls.at(-1)).toBe("deleteFunctionRegistry");
  });

  test("reads the job's outcome again after a transient error", async () => {
    const { client, mocks } = createMockClient({ result: '{"success":true}' });
    mocks.getFunctionExecution
      .mockRejectedValueOnce(new ConnectError("unavailable", Code.Unavailable))
      .mockImplementation(() =>
        Promise.resolve({
          execution: { logEntries: [], error: undefined, result: '{"success":true}' },
        }),
      );

    const outcome = await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(outcome).toMatchObject({ success: true, result: '{"success":true}' });
    expect(mocks.getFunctionExecution).toHaveBeenCalledTimes(2);
  });

  test("reports an unknown outcome when a finished workflow's job result cannot be found", async () => {
    const { client, mocks } = createMockClient();
    mocks.getFunctionExecution.mockResolvedValue({ execution: undefined } as never);

    const outcome = await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(outcome).toMatchObject({
      success: false,
      error: expect.stringContaining("unknown whether the script's changes were applied"),
    });
  });

  test("tells how a resource that could not be removed gets removed", async () => {
    const { client, mocks } = createMockClient();
    mocks.deleteWorkflow.mockRejectedValue(new ConnectError("unavailable", Code.Unavailable));

    await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(vi.mocked(logger.warn).mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining("It is removed by the next run."),
    ]);
  });

  test("reclaims the leftovers of an interrupted run before registering the script", async () => {
    const { client, calls } = createMockClient({ leftoverWorkflowId: "wf-old" });

    await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(calls.indexOf("deleteWorkflow")).toBeLessThan(calls.indexOf("createFunctionRegistry"));
  });
});

describe("keeping a script workflow", () => {
  const labels = { "seed-retry-chunk": "c2" };

  test("keeps the resources and records the labels on the workflow when use asks to retain", async () => {
    const { client, mocks } = createMockClient();

    await withScriptWorkflow({ ...baseOptions, client }, async (run, { retain }) => {
      await run({});
      retain(labels);
    });

    expect(writeMetadataLabelsDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trn: `trn:v1:workspace:ws:workflow:${baseOptions.name}`,
        labels,
      }),
    );
    expect(mocks.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("removes the resources when use throws after asking to retain", async () => {
    const { client, mocks } = createMockClient();

    await expect(
      withScriptWorkflow({ ...baseOptions, client }, async (_run, { retain }) => {
        retain(labels);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(mocks.deleteWorkflow).toHaveBeenCalledWith({ workspaceId: "ws", workflowId: "wf-1" });
  });

  test("removes the resources, warns and still returns the result when the labels cannot be recorded", async () => {
    const { client, mocks } = createMockClient({ result: '{"success":false}' });

    const outcome = await withScriptWorkflow(
      { ...baseOptions, client },
      async (run, { retain }) => {
        const result = await run({});
        vi.mocked(writeMetadataLabelsDirect).mockRejectedValueOnce(new Error("labels rejected"));
        retain(labels);
        return result;
      },
    );

    expect(outcome).toMatchObject({ success: true, result: '{"success":false}' });
    expect(mocks.deleteWorkflow).toHaveBeenCalledWith({ workspaceId: "ws", workflowId: "wf-1" });
    expect(vi.mocked(logger.warn).mock.calls.at(-1)?.[0]).toContain("labels rejected");
  });

  test("records the labels again after a transient error and keeps the resources", async () => {
    const { client, mocks } = createMockClient();

    await withScriptWorkflow({ ...baseOptions, client }, async (run, { retain }) => {
      await run({});
      vi.mocked(writeMetadataLabelsDirect)
        .mockRejectedValueOnce(new ConnectError("unavailable", Code.Unavailable))
        .mockResolvedValueOnce(true);
      retain(labels);
    });

    expect(mocks.deleteWorkflow).not.toHaveBeenCalled();
  });

  test("finds no workflow when none was kept", async () => {
    const { client } = createMockClient();

    await expect(
      inspectScriptWorkflow({ client, workspaceId: "ws", name: baseOptions.name }),
    ).resolves.toBeUndefined();
  });

  test("finds a kept workflow with its labels", async () => {
    const { client } = createMockClient({ leftoverWorkflowId: "wf-kept", workflowLabels: labels });

    await expect(
      inspectScriptWorkflow({ client, workspaceId: "ws", name: baseOptions.name }),
    ).resolves.toEqual({ workflowId: "wf-kept", labels, activeExecutionId: undefined });
  });

  test("reports the execution that is still running on a kept workflow", async () => {
    const { client } = createMockClient({
      leftoverWorkflowId: "wf-kept",
      executions: [
        { id: "exec-running", status: WorkflowExecution_Status.RUNNING },
        { id: "exec-old", status: WorkflowExecution_Status.FAILED },
      ],
    });

    const found = await inspectScriptWorkflow({
      client,
      workspaceId: "ws",
      name: baseOptions.name,
    });

    expect(found?.activeExecutionId).toBe("exec-running");
  });

  test("starts the kept workflow and removes it after use", async () => {
    const { client, mocks } = createMockClient({ result: '{"success":true}' });

    await withKeptScriptWorkflow(
      {
        client,
        workspaceId: "ws",
        name: baseOptions.name,
        workflowId: "wf-kept",
        invoker,
        leftoverNote: baseOptions.leftoverNote,
        pollIntervalMs: 1,
      },
      (run) => run({ chunk: 2 }),
    );

    expect(mocks.startWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: "wf-kept", arg: '{"chunk":2}' }),
    );
    expect(mocks.createWorkflow).not.toHaveBeenCalled();
    expect(mocks.deleteWorkflow).toHaveBeenCalledWith({ workspaceId: "ws", workflowId: "wf-kept" });
  });

  test("keeps the workflow again when use retains it after a retry", async () => {
    const { client, mocks } = createMockClient();

    await withKeptScriptWorkflow(
      {
        client,
        workspaceId: "ws",
        name: baseOptions.name,
        workflowId: "wf-kept",
        invoker,
        leftoverNote: baseOptions.leftoverNote,
        pollIntervalMs: 1,
      },
      async (run, { retain }) => {
        await run({});
        retain({ "seed-retry-chunk": "c3" });
      },
    );

    expect(mocks.deleteWorkflow).not.toHaveBeenCalled();
    expect(writeMetadataLabelsDirect).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ labels: { "seed-retry-chunk": "c3" } }),
    );
  });
});
