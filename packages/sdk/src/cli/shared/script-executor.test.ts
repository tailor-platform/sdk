import { FunctionExecution_Status } from "@tailor-platform/tailor-proto/function_resource_pb";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { waitForExecution, executeScript, DEFAULT_POLL_INTERVAL } from "./script-executor";
import type { OperatorClient } from "#/cli/shared/client";
import type { AuthInvoker } from "@tailor-platform/tailor-proto/auth_resource_pb";

// Mock client factory
function createMockClient(overrides: Partial<OperatorClient> = {}): OperatorClient {
  return {
    testExecScript: vi.fn(),
    getFunctionExecution: vi.fn(),
    ...overrides,
  } as unknown as OperatorClient;
}

// Mock auth invoker
const mockAuthInvoker: AuthInvoker = {
  namespace: "test-auth",
  machineUserName: "test-machine-user",
} as AuthInvoker;

function execution(
  status: FunctionExecution_Status,
  logs: string,
  result: string,
): { execution: { status: FunctionExecution_Status; logs: string; result: string } } {
  return { execution: { status, logs, result } };
}

describe("waitForExecution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test.each([
    [FunctionExecution_Status.SUCCESS, "test logs", '{"success":true}'],
    [FunctionExecution_Status.FAILED, "error logs", "Error: something went wrong"],
  ])("returns immediately when execution is %s", async (status, logs, result) => {
    const client = createMockClient({
      getFunctionExecution: vi.fn().mockResolvedValue(execution(status, logs, result)),
    });

    const outcome = await waitForExecution(client, "workspace-1", "exec-1");

    expect(outcome.status).toBe(status);
    expect(outcome.logs).toBe(logs);
    expect(outcome.result).toBe(result);
  });

  test("calls getFunctionExecution with the expected arguments", async () => {
    const client = createMockClient({
      getFunctionExecution: vi
        .fn()
        .mockResolvedValue(execution(FunctionExecution_Status.SUCCESS, "test logs", "{}")),
    });

    await waitForExecution(client, "workspace-1", "exec-1");

    expect(client.getFunctionExecution).toHaveBeenCalledTimes(1);
    expect(client.getFunctionExecution).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      executionId: "exec-1",
    });
  });

  test("throws error when execution is not found", async () => {
    const client = createMockClient({
      getFunctionExecution: vi.fn().mockResolvedValue({ execution: null }),
    });

    await expect(waitForExecution(client, "workspace-1", "exec-1")).rejects.toThrow(
      "Execution 'exec-1' not found.",
    );
  });

  test("polls until execution completes", async () => {
    const getFunctionExecution = vi
      .fn()
      .mockResolvedValueOnce(execution(FunctionExecution_Status.RUNNING, "", ""))
      .mockResolvedValueOnce(execution(FunctionExecution_Status.RUNNING, "partial logs", ""))
      .mockResolvedValueOnce(
        execution(FunctionExecution_Status.SUCCESS, "final logs", '{"done":true}'),
      );

    const client = createMockClient({ getFunctionExecution });

    const resultPromise = waitForExecution(client, "workspace-1", "exec-1", 100);

    // First call - RUNNING
    await vi.advanceTimersByTimeAsync(0);
    expect(getFunctionExecution).toHaveBeenCalledTimes(1);

    // Wait for first poll interval
    await vi.advanceTimersByTimeAsync(100);
    expect(getFunctionExecution).toHaveBeenCalledTimes(2);

    // Wait for second poll interval
    await vi.advanceTimersByTimeAsync(100);
    expect(getFunctionExecution).toHaveBeenCalledTimes(3);

    const result = await resultPromise;
    expect(result.status).toBe(FunctionExecution_Status.SUCCESS);
    expect(result.logs).toBe("final logs");
  });

  test("uses default poll interval", async () => {
    const getFunctionExecution = vi
      .fn()
      .mockResolvedValueOnce(execution(FunctionExecution_Status.RUNNING, "", ""))
      .mockResolvedValueOnce(execution(FunctionExecution_Status.SUCCESS, "done", ""));

    const client = createMockClient({ getFunctionExecution });

    const resultPromise = waitForExecution(client, "workspace-1", "exec-1");

    // First call
    await vi.advanceTimersByTimeAsync(0);
    expect(getFunctionExecution).toHaveBeenCalledTimes(1);

    // Should wait for DEFAULT_POLL_INTERVAL before next call
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL - 1);
    expect(getFunctionExecution).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(getFunctionExecution).toHaveBeenCalledTimes(2);

    await resultPromise;
  });
});

describe("executeScript", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createExecScriptMockClient(
    execResult: { execution: { status: FunctionExecution_Status; logs: string; result: string } },
    testExecScriptResponse: { executionId: string; result?: string } = { executionId: "exec-123" },
  ) {
    return createMockClient({
      testExecScript: vi.fn().mockResolvedValue(testExecScriptResponse),
      getFunctionExecution: vi.fn().mockResolvedValue(execResult),
    });
  }

  test("executes script and returns success result", async () => {
    const client = createExecScriptMockClient(
      execution(
        FunctionExecution_Status.SUCCESS,
        "Script executed successfully",
        '{"data":"test"}',
      ),
    );

    const result = await executeScript({
      client,
      workspaceId: "workspace-1",
      name: "test-script.js",
      code: "export function main() { return { success: true }; }",
      arg: '{"input":"value"}',
      invoker: mockAuthInvoker,
    });

    expect(result.success).toBe(true);
    expect(result.logs).toBe("Script executed successfully");
    expect(result.result).toBe('{"data":"test"}');
    expect(result.error).toBeUndefined();

    expect(client.testExecScript).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      name: "test-script.js",
      code: "export function main() { return { success: true }; }",
      arg: '{"input":"value"}',
      invoker: mockAuthInvoker,
    });
  });

  test("executes script with default empty arg", async () => {
    const client = createExecScriptMockClient(execution(FunctionExecution_Status.SUCCESS, "", ""));

    await executeScript({
      client,
      workspaceId: "workspace-1",
      name: "test-script.js",
      code: "code",
      invoker: mockAuthInvoker,
    });

    expect(client.testExecScript).toHaveBeenCalledWith(expect.objectContaining({ arg: "{}" }));
  });

  test("returns failure result when script fails", async () => {
    const client = createExecScriptMockClient(
      execution(
        FunctionExecution_Status.FAILED,
        "Error: TypeError: undefined is not a function",
        "Script execution failed",
      ),
    );

    const result = await executeScript({
      client,
      workspaceId: "workspace-1",
      name: "failing-script.js",
      code: "invalid code",
      invoker: mockAuthInvoker,
    });

    expect(result.success).toBe(false);
    expect(result.logs).toBe("Error: TypeError: undefined is not a function");
    expect(result.result).toBe("Script execution failed");
    expect(result.error).toBe("Script execution failed");
  });

  test("returns error message when logs and result are empty", async () => {
    const client = createExecScriptMockClient(execution(FunctionExecution_Status.FAILED, "", ""));

    const result = await executeScript({
      client,
      workspaceId: "workspace-1",
      name: "empty-error-script.js",
      code: "code",
      invoker: mockAuthInvoker,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Script execution failed with unknown error");
  });

  test("uses custom poll interval", async () => {
    const getFunctionExecution = vi
      .fn()
      .mockResolvedValueOnce(execution(FunctionExecution_Status.RUNNING, "", ""))
      .mockResolvedValueOnce(execution(FunctionExecution_Status.SUCCESS, "", ""));

    const client = createMockClient({
      testExecScript: vi.fn().mockResolvedValue({ executionId: "exec-123" }),
      getFunctionExecution,
    });

    const customPollInterval = 500;
    const resultPromise = executeScript({
      client,
      workspaceId: "workspace-1",
      name: "test-script.js",
      code: "code",
      invoker: mockAuthInvoker,
      pollInterval: customPollInterval,
    });

    // Initial call
    await vi.advanceTimersByTimeAsync(0);
    expect(getFunctionExecution).toHaveBeenCalledTimes(1);

    // Should wait for custom interval
    await vi.advanceTimersByTimeAsync(customPollInterval - 1);
    expect(getFunctionExecution).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(getFunctionExecution).toHaveBeenCalledTimes(2);

    await resultPromise;
  });

  test("uses response.result as fallback when execution result is empty", async () => {
    const client = createExecScriptMockClient(execution(FunctionExecution_Status.FAILED, "", ""), {
      executionId: "exec-123",
      result: "compilation error: invalid syntax",
    });

    const result = await executeScript({
      client,
      workspaceId: "workspace-1",
      name: "test-script.js",
      code: "invalid code",
      invoker: mockAuthInvoker,
    });

    expect(result.success).toBe(false);
    expect(result.result).toBe("compilation error: invalid syntax");
    expect(result.error).toBe("compilation error: invalid syntax");
  });

  test("includes response.result in error details alongside execution result", async () => {
    const client = createExecScriptMockClient(
      execution(FunctionExecution_Status.FAILED, "runtime error log", "execution failed"),
      { executionId: "exec-123", result: "initial error info" },
    );

    const result = await executeScript({
      client,
      workspaceId: "workspace-1",
      name: "test-script.js",
      code: "code",
      invoker: mockAuthInvoker,
    });

    expect(result.success).toBe(false);
    expect(result.result).toBe("execution failed");
    expect(result.error).toBe("execution failed");
  });

  test("propagates testExecScript errors", async () => {
    const client = createMockClient({
      testExecScript: vi.fn().mockRejectedValue(new Error("API error")),
    });

    await expect(
      executeScript({
        client,
        workspaceId: "workspace-1",
        name: "test-script.js",
        code: "code",
        invoker: mockAuthInvoker,
      }),
    ).rejects.toThrow("API error");
  });
});
