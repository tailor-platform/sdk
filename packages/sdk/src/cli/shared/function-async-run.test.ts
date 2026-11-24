import { Code, ConnectError } from "@connectrpc/connect";
import { FunctionExecution_Status } from "@tailor-platform/tailor-proto/function_resource_pb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { writeMetadataLabelsDirect } from "#/cli/commands/deploy/label";
import { awaitFunctionAsyncRun, startFunctionAsyncRun } from "./function-async-run";
import { logger } from "./logger";
import { mockOperatorClient } from "./test-helpers/operator-client";
import { createRunId, workflowRunLabels } from "./workflow-run-labels";
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
  vi.mocked(logger.warn).mockClear();
});

const invoker = { namespace: "auth", machineUserName: "runner" } as ScriptInvoker;
const runId = createRunId(new Date("2026-11-18T13:00:00Z"), "aaaaaa");
const name = `tmp-run-${runId}`;

interface ClientOptions {
  status?: FunctionExecution_Status;
  result?: string;
  error?: string;
}

function createClient(options: ClientOptions = {}) {
  return mockOperatorClient({
    getAuthMachineUser: async () => ({ machineUser: {} }),
    createFunctionRegistry: async () => ({}),
    startJobFunction: async () => ({ executionId: "exec-1" }),
    getFunctionExecution: async () => ({
      execution: {
        status: options.status ?? FunctionExecution_Status.SUCCESS,
        result: options.result ?? '{"ok":true}',
        logEntries: [{ message: "hello" }],
        ...(options.error === undefined ? {} : { error: { message: options.error } }),
      },
    }),
    deleteFunctionRegistry: async () => ({}),
  });
}

describe("startFunctionAsyncRun", () => {
  test("registers the function under the run's name and starts it directly with the argument and invoker", async () => {
    const client = createClient();
    const started = await startFunctionAsyncRun({
      client,
      workspaceId: "ws",
      runId,
      code: "export async function main() {}",
      description: "function run --async",
      invoker,
      arg: { n: 1 },
    });

    expect(started).toEqual({ runId, name, executionId: "exec-1" });
    expect(client.startJobFunction).toHaveBeenCalledWith({
      workspaceId: "ws",
      scriptRef: name,
      arg: '{"n":1}',
      invoker,
    });
  });

  test("starts a function given no argument with an empty object, as a synchronous run does", async () => {
    const client = createClient();
    await startFunctionAsyncRun({
      client,
      workspaceId: "ws",
      runId,
      code: "",
      description: "d",
      invoker,
      arg: undefined,
    });

    expect(client.startJobFunction.mock.calls[0]?.[0].arg).toBe("{}");
  });

  test("labels the function with the run key and no owner, and creates nothing else", async () => {
    const client = createClient();
    await startFunctionAsyncRun({
      client,
      workspaceId: "ws",
      runId,
      code: "",
      description: "d",
      invoker,
      arg: undefined,
    });

    const writes = vi.mocked(writeMetadataLabelsDirect).mock.calls.map(([, write]) => write);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.trn).toBe(`trn:v1:workspace:ws:function_registry:${name}`);
    expect(writes[0]?.labels).toEqual(workflowRunLabels({ runId }));
  });

  test("refuses a machine user that does not exist before registering anything", async () => {
    const client = createClient();
    client.getAuthMachineUser.mockRejectedValue(new ConnectError("no", Code.NotFound));

    await expect(
      startFunctionAsyncRun({
        client,
        workspaceId: "ws",
        runId,
        code: "",
        description: "d",
        invoker,
        arg: undefined,
      }),
    ).rejects.toThrow(/runner/);
    expect(client.createFunctionRegistry).not.toHaveBeenCalled();
  });

  test("removes the function when the Platform refuses to start it", async () => {
    const client = createClient();
    client.startJobFunction.mockRejectedValue(new ConnectError("bad", Code.InvalidArgument));

    await expect(
      startFunctionAsyncRun({
        client,
        workspaceId: "ws",
        runId,
        code: "",
        description: "d",
        invoker,
        arg: undefined,
      }),
    ).rejects.toThrow(/bad/);
    expect(client.deleteFunctionRegistry).toHaveBeenCalledWith({ workspaceId: "ws", name });
  });

  test("keeps the function when it cannot tell whether the start was accepted", async () => {
    const client = createClient();
    client.startJobFunction.mockRejectedValue(new ConnectError("lost", Code.Unavailable));

    await expect(
      startFunctionAsyncRun({
        client,
        workspaceId: "ws",
        runId,
        code: "",
        description: "d",
        invoker,
        arg: undefined,
      }),
    ).rejects.toThrow(/lost/);
    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("tailor workflow prune"));
  });

  test("removes nothing when the name is already taken, because this call created nothing", async () => {
    const client = createClient();
    client.createFunctionRegistry.mockRejectedValue(new ConnectError("exists", Code.AlreadyExists));

    await expect(
      startFunctionAsyncRun({
        client,
        workspaceId: "ws",
        runId,
        code: "",
        description: "d",
        invoker,
        arg: undefined,
      }),
    ).rejects.toThrow(/exists/);
    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });
});

const started = { runId, name, executionId: "exec-1" };

describe("awaitFunctionAsyncRun", () => {
  test("reports the result and the logs, and removes the function once it succeeds", async () => {
    const client = createClient();
    const outcome = await awaitFunctionAsyncRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome).toEqual({
      state: "finished",
      result: { success: true, logs: "hello", result: '{"ok":true}' },
    });
    expect(client.deleteFunctionRegistry).toHaveBeenCalledWith({ workspaceId: "ws", name });
  });

  test("reports a failed execution with its error message, and still removes the function", async () => {
    const client = createClient({
      status: FunctionExecution_Status.FAILED,
      result: "",
      error: "Error: boom",
    });
    const outcome = await awaitFunctionAsyncRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome).toMatchObject({
      state: "finished",
      result: { success: false, error: "Error: boom" },
    });
    expect(client.deleteFunctionRegistry).toHaveBeenCalledOnce();
  });

  test("keeps the name and the stack trace of the error, which `function logs` shows and the source map needs", async () => {
    const client = createClient({
      status: FunctionExecution_Status.FAILED,
      result: "",
    });
    client.getFunctionExecution.mockResolvedValue({
      execution: {
        status: FunctionExecution_Status.FAILED,
        result: "",
        logEntries: [],
        error: {
          name: "Runtime error",
          message: "Error: boom",
          stackTrace: "    at main (file:///tmp-run-x:5:9)",
        },
      },
    });
    const outcome = await awaitFunctionAsyncRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome).toMatchObject({
      state: "finished",
      result: {
        success: false,
        error: "Runtime error: Error: boom\n    at main (file:///tmp-run-x:5:9)",
      },
    });
  });

  test("reports a canceled execution as failed", async () => {
    const client = createClient({ status: FunctionExecution_Status.CANCELED, result: "" });
    const outcome = await awaitFunctionAsyncRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome).toMatchObject({
      state: "finished",
      result: { success: false, error: "Script execution was canceled" },
    });
  });

  test("keeps polling while the execution runs, and leaves the function in place when the wait times out", async () => {
    vi.useFakeTimers();
    try {
      const client = createClient({ status: FunctionExecution_Status.RUNNING });
      const waiting = awaitFunctionAsyncRun({
        client,
        workspaceId: "ws",
        started,
        pollInterval: 1000,
        timeoutMs: 3500,
      });
      await vi.advanceTimersByTimeAsync(4000);

      await expect(waiting).resolves.toEqual({ state: "timedOut" });
      expect(client.getFunctionExecution.mock.calls.length).toBeGreaterThan(2);
      expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("waits without a limit when the wait is unlimited", async () => {
    const client = createClient();
    client.getFunctionExecution
      .mockResolvedValueOnce({
        execution: { status: FunctionExecution_Status.RUNNING, logEntries: [] },
      })
      .mockResolvedValueOnce({
        execution: {
          status: FunctionExecution_Status.SUCCESS,
          result: "1",
          logEntries: [],
        },
      });
    const outcome = await awaitFunctionAsyncRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: Number.POSITIVE_INFINITY,
    });

    expect(outcome).toMatchObject({ state: "finished", result: { success: true, result: "1" } });
  });

  test("polls through a transient error", async () => {
    const client = createClient();
    client.getFunctionExecution.mockRejectedValueOnce(new ConnectError("blip", Code.Unavailable));
    const outcome = await awaitFunctionAsyncRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome).toMatchObject({ state: "finished", result: { success: true } });
  });

  test("keeps the function and reports the outcome as unavailable when reading fails for a reason that polling again would not fix", async () => {
    const client = createClient();
    client.getFunctionExecution.mockRejectedValue(
      new ConnectError("denied", Code.PermissionDenied),
    );
    const outcome = await awaitFunctionAsyncRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome).toEqual({ state: "outcomeUnavailable", reason: "[permission_denied] denied" });
    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });

  test("keeps the function and reports the outcome as unavailable when the execution cannot be found", async () => {
    const client = createClient();
    client.getFunctionExecution.mockRejectedValue(new ConnectError("gone", Code.NotFound));
    const outcome = await awaitFunctionAsyncRun({
      client,
      workspaceId: "ws",
      started,
      pollInterval: 1,
      timeoutMs: 1000,
    });

    expect(outcome).toMatchObject({ state: "outcomeUnavailable" });
    expect(client.deleteFunctionRegistry).not.toHaveBeenCalled();
  });
});
