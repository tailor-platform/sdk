import { FunctionExecution_Status } from "@tailor-proto/tailor/v1/function_resource_pb";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { waitForExecution, executeScript, DEFAULT_POLL_INTERVAL } from "./script-executor";
import type { OperatorClient } from "../client";
import type { AuthInvoker } from "@tailor-proto/tailor/v1/auth_resource_pb";

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

describe("waitForExecution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  test("returns immediately when execution is SUCCESS", async () => {
    const client = createMockClient({
      getFunctionExecution: vi.fn().mockResolvedValue({
        execution: {
          status: FunctionExecution_Status.SUCCESS,
          logs: "test logs",
          result: '{"success":true}',
        },
      }),
    });

    const resultPromise = waitForExecution(client, "workspace-1", "exec-1");
    const result = await resultPromise;

    expect(result.status).toBe(FunctionExecution_Status.SUCCESS);
    expect(result.logs).toBe("test logs");
    expect(result.result).toBe('{"success":true}');
    expect(client.getFunctionExecution).toHaveBeenCalledTimes(1);
    expect(client.getFunctionExecution).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      executionId: "exec-1",
    });
  });

  test("returns immediately when execution is FAILED", async () => {
    const client = createMockClient({
      getFunctionExecution: vi.fn().mockResolvedValue({
        execution: {
          status: FunctionExecution_Status.FAILED,
          logs: "error logs",
          result: "Error: something went wrong",
        },
      }),
    });

    const result = await waitForExecution(client, "workspace-1", "exec-1");

    expect(result.status).toBe(FunctionExecution_Status.FAILED);
    expect(result.logs).toBe("error logs");
    expect(result.result).toBe("Error: something went wrong");
  });

  test("throws error when execution is not found", async () => {
    const client = createMockClient({
      getFunctionExecution: vi.fn().mockResolvedValue({
        execution: null,
      }),
    });

    await expect(waitForExecution(client, "workspace-1", "exec-1")).rejects.toThrow(
      "Execution 'exec-1' not found.",
    );
  });

  test("polls until execution completes", async () => {
    const getFunctionExecution = vi
      .fn()
      .mockResolvedValueOnce({
        execution: {
          status: FunctionExecution_Status.RUNNING,
          logs: "",
          result: "",
        },
      })
      .mockResolvedValueOnce({
        execution: {
          status: FunctionExecution_Status.RUNNING,
          logs: "partial logs",
          result: "",
        },
      })
      .mockResolvedValueOnce({
        execution: {
          status: FunctionExecution_Status.SUCCESS,
          logs: "final logs",
          result: '{"done":true}',
        },
      });

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
      .mockResolvedValueOnce({
        execution: {
          status: FunctionExecution_Status.RUNNING,
          logs: "",
          result: "",
        },
      })
      .mockResolvedValueOnce({
        execution: {
          status: FunctionExecution_Status.SUCCESS,
          logs: "done",
          result: "",
        },
      });

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

  test("executes script and returns success result", async () => {
    const client = createMockClient({
      testExecScript: vi.fn().mockResolvedValue({
        executionId: "exec-123",
      }),
      getFunctionExecution: vi.fn().mockResolvedValue({
        execution: {
          status: FunctionExecution_Status.SUCCESS,
          logs: "Script executed successfully",
          result: '{"data":"test"}',
        },
      }),
    });

    const resultPromise = executeScript({
      client,
      workspaceId: "workspace-1",
      name: "test-script.js",
      code: "export function main() { return { success: true }; }",
      arg: '{"input":"value"}',
      invoker: mockAuthInvoker,
    });

    const result = await resultPromise;

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
    const client = createMockClient({
      testExecScript: vi.fn().mockResolvedValue({
        executionId: "exec-123",
      }),
      getFunctionExecution: vi.fn().mockResolvedValue({
        execution: {
          status: FunctionExecution_Status.SUCCESS,
          logs: "",
          result: "",
        },
      }),
    });

    await executeScript({
      client,
      workspaceId: "workspace-1",
      name: "test-script.js",
      code: "code",
      invoker: mockAuthInvoker,
    });

    expect(client.testExecScript).toHaveBeenCalledWith(
      expect.objectContaining({
        arg: "{}",
      }),
    );
  });

  test("returns failure result when script fails", async () => {
    const client = createMockClient({
      testExecScript: vi.fn().mockResolvedValue({
        executionId: "exec-123",
      }),
      getFunctionExecution: vi.fn().mockResolvedValue({
        execution: {
          status: FunctionExecution_Status.FAILED,
          logs: "Error: TypeError: undefined is not a function",
          result: "Script execution failed",
        },
      }),
    });

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
    expect(result.error).toBe(
      "Error: TypeError: undefined is not a function\nScript execution failed",
    );
  });

  test("returns error message when logs and result are empty", async () => {
    const client = createMockClient({
      testExecScript: vi.fn().mockResolvedValue({
        executionId: "exec-123",
      }),
      getFunctionExecution: vi.fn().mockResolvedValue({
        execution: {
          status: FunctionExecution_Status.FAILED,
          logs: "",
          result: "",
        },
      }),
    });

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
      .mockResolvedValueOnce({
        execution: {
          status: FunctionExecution_Status.RUNNING,
          logs: "",
          result: "",
        },
      })
      .mockResolvedValueOnce({
        execution: {
          status: FunctionExecution_Status.SUCCESS,
          logs: "",
          result: "",
        },
      });

    const client = createMockClient({
      testExecScript: vi.fn().mockResolvedValue({
        executionId: "exec-123",
      }),
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
