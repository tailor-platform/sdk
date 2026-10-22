import { Code, ConnectError } from "@connectrpc/connect";
import { WorkflowExecution_Status } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { describe, expect, test, vi } from "vitest";
import { withScriptWorkflow } from "./script-workflow";
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

  test("reclaims the leftovers of an interrupted run before registering the script", async () => {
    const { client, calls } = createMockClient({ leftoverWorkflowId: "wf-old" });

    await withScriptWorkflow({ ...baseOptions, client }, (run) => run({}));

    expect(calls.indexOf("deleteWorkflow")).toBeLessThan(calls.indexOf("createFunctionRegistry"));
  });
});
