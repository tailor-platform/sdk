import { stripVTControlCharacters } from "node:util";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import {
  FunctionErrorKind,
  FunctionExecution_Status,
  FunctionExecution_Type,
  FunctionExecutionSchema,
  FunctionLogEntrySchema,
  FunctionLogSeverity,
} from "@tailor-platform/tailor-proto/function_resource_pb";
import { aroundEach, describe, test, expect, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import {
  captureStderr,
  captureStdout,
  captureStdoutStream,
} from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { stripAnsi } from "#/cli/shared/test-helpers/strip-ansi";
import {
  composeExecutionErrorString,
  downloadScriptForMapping,
  formatExecutionError,
  logsCommand,
} from "./logs";
import type { OperatorClient } from "#/cli/shared/client";
import type { FunctionExecution } from "@tailor-platform/tailor-proto/function_resource_pb";

function makeDownloadClient(chunks: Uint8Array[], metadata?: { updatedAt: Date }): OperatorClient {
  return {
    downloadFunctionRegistryScript: vi.fn(async function* () {
      yield {
        payload: {
          case: "metadata" as const,
          value: metadata ? { function: { updatedAt: timestampFromDate(metadata.updatedAt) } } : {},
        },
      };
      for (const c of chunks) {
        yield { payload: { case: "chunk" as const, value: c } };
      }
    }),
  } as unknown as OperatorClient;
}

function makeInlineSourcemapBundle(sourcemap: object, code: string): string {
  const json = JSON.stringify(sourcemap);
  const base64 = Buffer.from(json).toString("base64");
  return `${code}\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}`;
}

describe("composeExecutionErrorString", () => {
  test("returns 'Name: message' when stackTrace is empty", () => {
    const result = composeExecutionErrorString({
      name: "Error",
      message: "boom",
      stackTrace: "",
    });
    expect(result).toBe("Error: boom");
  });

  test("uses stackTrace as-is when it already starts with the message line", () => {
    const stackTrace = "Error: boom\n    at fn (file:///b.js:1:1)";
    const result = composeExecutionErrorString({
      name: "Error",
      message: "boom",
      stackTrace,
    });
    expect(result).toBe(stackTrace);
  });

  test("prepends 'Name: message' when stackTrace starts with frame lines", () => {
    const stackTrace = "    at fn (file:///b.js:1:1)\n    at g (file:///b.js:1:2)";
    const result = composeExecutionErrorString({
      name: "TypeError",
      message: "x is undefined",
      stackTrace,
    });
    expect(result).toBe(`TypeError: x is undefined\n${stackTrace}`);
  });
});

describe("formatExecutionError", () => {
  const sourceContent = [
    'import { createResolver } from "@tailor-platform/sdk";',
    "",
    "function throwError() {",
    '  throw new Error("intentional error");',
    "}",
  ].join("\n");

  function makeRealisticBundle(): string {
    const sourcemap = {
      version: 3,
      sources: ["resolvers/error-test.ts"],
      sourcesContent: [sourceContent],
      names: ["throwError"],
      // output (1,0) -> source 0, line 4 (1-based), col 3 (1-based)
      mappings: "AAGEA",
    };
    return makeInlineSourcemapBundle(
      sourcemap,
      'function M(){throw new Error("intentional error")}M();',
    );
  }

  test("formats with sourcemap when bundled code and stack trace are available", () => {
    const bundledCode = makeRealisticBundle();
    const error = {
      name: "Error",
      message: "intentional error",
      stackTrace: "Error: intentional error\n    at throwError (file:///bundle.js:4:3)",
    };

    const result = formatExecutionError(error, bundledCode);
    const plain = stripVTControlCharacters(result);

    expect(plain).toContain("Error: intentional error");
    expect(plain).toContain("resolvers/error-test.ts:4:3");
    expect(plain).toContain('throw new Error("intentional error")');
  });

  test("falls back to plain text when bundled code is null", () => {
    const error = {
      name: "Error",
      message: "boom",
      stackTrace: "Error: boom\n    at fn (file:///b.js:1:1)",
    };

    const result = formatExecutionError(error, null);
    const plain = stripVTControlCharacters(result);

    expect(plain).toContain("Error: boom");
    expect(plain).toContain("at fn (file:///b.js:1:1)");
    // Sourcemap mapping markers must NOT appear
    expect(plain).not.toContain("> 1");
    // Error header must appear exactly once (stackTrace already contains it)
    expect(plain.match(/Error: boom/g)).toHaveLength(1);
  });

  test("fallback does not duplicate header when stackTrace begins with frame lines", () => {
    const error = {
      name: "Error",
      message: "boom",
      stackTrace: "    at fn (file:///b.js:1:1)",
    };

    const result = formatExecutionError(error, null);
    const plain = stripVTControlCharacters(result);

    // Header must be present (synthesized from name/message)
    expect(plain).toContain("Error: boom");
    expect(plain).toContain("at fn (file:///b.js:1:1)");
    expect(plain.match(/Error: boom/g)).toHaveLength(1);
  });

  test("falls back to plain text when stackTrace is empty", () => {
    const bundledCode = makeRealisticBundle();
    const error = {
      name: "ValidationError",
      message: "name is required",
      stackTrace: "",
    };

    const result = formatExecutionError(error, bundledCode);
    const plain = stripVTControlCharacters(result);

    expect(plain).toContain("ValidationError: name is required");
  });

  test("falls back to plain text when bundle has no inline sourcemap", () => {
    const error = {
      name: "Error",
      message: "boom",
      stackTrace: "Error: boom\n    at fn (file:///b.js:1:1)",
    };

    const result = formatExecutionError(error, "// no sourcemap here\nconsole.log('x');");
    const plain = stripVTControlCharacters(result);

    expect(plain).toContain("Error: boom");
    expect(plain).toContain("at fn (file:///b.js:1:1)");
  });

  test("works when stackTrace has only frame lines (no message line)", () => {
    const bundledCode = makeRealisticBundle();
    const error = {
      name: "Error",
      message: "intentional error",
      stackTrace: "    at throwError (file:///bundle.js:4:3)",
    };

    const result = formatExecutionError(error, bundledCode);
    const plain = stripVTControlCharacters(result);

    expect(plain).toContain("Error: intentional error");
    expect(plain).toContain("resolvers/error-test.ts:4:3");
  });
});

describe("downloadScriptForMapping", () => {
  test("returns null when scriptName does not map to a registry entry (test-run)", async () => {
    const client = makeDownloadClient([]);

    const result = await downloadScriptForMapping({
      client,
      workspaceId: "ws-1",
      scriptName: "test-run--throwError.js",
      executionType: FunctionExecution_Type.STANDARD,
      executionContentHash: "abc123",
    });

    expect(result).toBeNull();
    expect(client.downloadFunctionRegistryScript).not.toHaveBeenCalled();
  });

  describe("with pinned download (executionContentHash present)", () => {
    test("passes executionContentHash to the RPC and returns the pinned bundle", async () => {
      const client = makeDownloadClient([new TextEncoder().encode("pinned-code")]);

      const result = await downloadScriptForMapping({
        client,
        workspaceId: "ws-1",
        scriptName: "my-resolver.throwError.body.js",
        executionType: FunctionExecution_Type.STANDARD,
        executionContentHash: "abc123",
      });

      expect(result).toBe("pinned-code");
      expect(client.downloadFunctionRegistryScript).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        name: "resolver--my-resolver--throwError",
        contentHash: "abc123",
      });
    });

    test("returns code even when registry was redeployed after the execution", async () => {
      // Pinning by contentHash asks the server for the exact bundle that
      // ran, so a newer registry updatedAt does not affect the result.
      const client = makeDownloadClient([new TextEncoder().encode("pinned-code")], {
        updatedAt: new Date("2024-03-01T00:00:00Z"),
      });

      const result = await downloadScriptForMapping({
        client,
        workspaceId: "ws-1",
        scriptName: "my-resolver.throwError.body.js",
        executionType: FunctionExecution_Type.STANDARD,
        executionContentHash: "abc123",
      });

      expect(result).toBe("pinned-code");
    });

    test("downloads workflow job script whose name contains dots under JOB type", async () => {
      const client = makeDownloadClient([new TextEncoder().encode("job-code")]);

      const result = await downloadScriptForMapping({
        client,
        workspaceId: "ws-1",
        scriptName: "billing.retry.v2",
        executionType: FunctionExecution_Type.JOB,
        executionContentHash: "deadbeef",
      });

      expect(result).toBe("job-code");
      expect(client.downloadFunctionRegistryScript).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        name: "workflow--billing.retry.v2",
        contentHash: "deadbeef",
      });
    });

    test("returns null when the pinned download yields no chunks", async () => {
      const client = makeDownloadClient([]);

      const result = await downloadScriptForMapping({
        client,
        workspaceId: "ws-1",
        scriptName: "my-resolver.throwError.body.js",
        executionType: FunctionExecution_Type.STANDARD,
        executionContentHash: "abc123",
      });

      expect(result).toBeNull();
    });
  });

  describe("without executionContentHash", () => {
    test("skips mapping without downloading the current registry script", async () => {
      const client = makeDownloadClient([new TextEncoder().encode("code")]);

      const result = await downloadScriptForMapping({
        client,
        workspaceId: "ws-1",
        scriptName: "my-resolver.throwError.body.js",
        executionType: FunctionExecution_Type.STANDARD,
        executionContentHash: "",
      });

      expect(result).toBeNull();
      expect(client.downloadFunctionRegistryScript).not.toHaveBeenCalled();
    });
  });
});

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn().mockResolvedValue("workspace-1"),
}));

vi.mock("#/cli/shared/client", async (importActual) => {
  const actual = await importActual<object>();
  return { ...actual, initOperatorClient: vi.fn() };
});

function logEntry(message: string, severity: FunctionLogSeverity, at: string) {
  return create(FunctionLogEntrySchema, {
    message,
    severity,
    timestamp: timestampFromDate(new Date(at)),
  });
}

function functionExecution(
  overrides: MessageInitShape<typeof FunctionExecutionSchema>,
): FunctionExecution {
  return create(FunctionExecutionSchema, {
    id: "exec-1",
    scriptName: "workflow--billing.main",
    status: FunctionExecution_Status.SUCCESS,
    type: FunctionExecution_Type.JOB,
    ...overrides,
  });
}

function mockClient(responses: FunctionExecution[]): ReturnType<typeof vi.fn> {
  const getFunctionExecution = vi.fn();
  for (const execution of responses) {
    getFunctionExecution.mockResolvedValueOnce({ execution });
  }
  vi.mocked(initOperatorClient).mockResolvedValue({
    getFunctionExecution,
  } as unknown as OperatorClient);
  return getFunctionExecution;
}

describe("logs command detail output", () => {
  const entries = [
    logEntry("starting", FunctionLogSeverity.INFO, "2026-09-05T00:00:00.000Z"),
    logEntry("careful", FunctionLogSeverity.WARNING, "2026-09-05T00:00:01.000Z"),
  ];

  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    await runTest();
  });

  test("--json includes structured log entries", async () => {
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();
    mockClient([functionExecution({ logEntries: entries, result: '{"ok":true}' })]);

    await runCommand(logsCommand, ["exec-1"]);

    expect(JSON.parse(stdout.output)).toMatchObject({
      id: "exec-1",
      status: "SUCCESS",
      logs: "starting\ncareful",
      logEntries: [
        { message: "starting", severity: "INFO", timestamp: "2026-09-05T00:00:00.000Z" },
        { message: "careful", severity: "WARNING", timestamp: "2026-09-05T00:00:01.000Z" },
      ],
    });
  });

  test("prints each structured entry once", async () => {
    using _stdout = captureStdout();
    using stderr = captureStderr();
    mockClient([functionExecution({ logEntries: entries })]);

    await runCommand(logsCommand, ["exec-1"]);

    const plain = stripAnsi(stderr.output);
    expect(plain).toContain("2026-09-05T00:00:00.000Z [INFO] starting");
    expect(plain).toContain("2026-09-05T00:00:01.000Z [WARNING] careful");
    expect(plain.match(/starting/g)).toHaveLength(1);
  });

  test("--json reports the error kind next to a consistent error object", async () => {
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();
    const error = {
      name: "TypeError",
      message: "x is undefined",
      stackTrace: "TypeError: x is undefined\n    at main (file:///bundle.js:1:1)",
    };
    mockClient([
      functionExecution({
        status: FunctionExecution_Status.FAILED,
        errorKind: FunctionErrorKind.USER_RUNTIME,
        error,
      }),
    ]);

    await runCommand(logsCommand, ["exec-1"]);

    const parsed = JSON.parse(stdout.output);
    expect(parsed).toMatchObject({
      status: "FAILED",
      errorKind: "USER_RUNTIME",
      errorName: error.name,
      errorMessage: error.message,
      error,
    });
  });

  test("shows the error kind in the summary", async () => {
    using stdout = captureStdoutStream();
    using _stderr = captureStderr();
    mockClient([
      functionExecution({
        status: FunctionExecution_Status.FAILED,
        errorKind: FunctionErrorKind.PLATFORM,
      }),
    ]);

    await runCommand(logsCommand, ["exec-1"]);

    expect(stripAnsi(stdout.output)).toMatch(/errorKind\s*│\s*PLATFORM/);
  });

  test("omits the logs section when no entries are available", async () => {
    using _stdout = captureStdout();
    using stderr = captureStderr();
    mockClient([functionExecution({})]);

    await runCommand(logsCommand, ["exec-1"]);

    expect(stripAnsi(stderr.output)).not.toContain("Logs:");
  });

  test("--follow prints each entry once as it arrives and stops at a terminal status", async () => {
    using _stdout = captureStdout();
    using stderr = captureStderr();
    const first = logEntry("one", FunctionLogSeverity.LOG, "2026-09-05T00:00:00.000Z");
    const second = logEntry("two", FunctionLogSeverity.LOG, "2026-09-05T00:00:01.000Z");
    const third = logEntry("three", FunctionLogSeverity.ERROR, "2026-09-05T00:00:02.000Z");
    const getFunctionExecution = mockClient([
      functionExecution({ status: FunctionExecution_Status.RUNNING, logEntries: [first] }),
      functionExecution({ status: FunctionExecution_Status.RUNNING, logEntries: [first, second] }),
      functionExecution({
        status: FunctionExecution_Status.FAILED,
        logEntries: [first, second, third],
        error: { name: "Error", message: "boom", stackTrace: "" },
      }),
    ]);

    await runCommand(logsCommand, ["exec-1", "--follow", "--interval", "1ms"]);

    const plain = stripAnsi(stderr.output);
    expect(getFunctionExecution).toHaveBeenCalledTimes(3);
    expect(plain.indexOf("[LOG] one")).toBeLessThan(plain.indexOf("[LOG] two"));
    expect(plain.indexOf("[LOG] two")).toBeLessThan(plain.indexOf("[ERROR] three"));
    expect(plain.match(/\[LOG\] one/g)).toHaveLength(1);
    expect(plain.match(/\[LOG\] two/g)).toHaveLength(1);
    expect(plain).toContain("Status: FAILED");
    expect(plain).toContain("Error: boom");
  });

  test("--follow reprints the summary with the final status after following", async () => {
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    const writes: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      mockClient([
        functionExecution({ status: FunctionExecution_Status.RUNNING }),
        functionExecution({ status: FunctionExecution_Status.SUCCESS }),
      ]);

      await runCommand(logsCommand, ["exec-1", "--follow", "--interval", "1ms"]);
    } finally {
      stdoutWrite.mockRestore();
    }

    const tables = writes.map(stripAnsi).filter((chunk) => chunk.includes("scriptName"));
    expect(tables).toHaveLength(2);
    expect(tables[0]).toContain("RUNNING");
    expect(tables[1]).toContain("SUCCESS");
  });

  test("--follow --timeout stops with an error when the execution does not finish", async () => {
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    const getFunctionExecution = vi.fn().mockResolvedValue({
      execution: functionExecution({ status: FunctionExecution_Status.RUNNING }),
    });
    vi.mocked(initOperatorClient).mockResolvedValue({
      getFunctionExecution,
    } as unknown as OperatorClient);

    const result = await runCommand(logsCommand, [
      "exec-1",
      "--follow",
      "--interval",
      "1ms",
      "--timeout",
      "20ms",
    ]);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("Timed out");
    expect(result.error?.message).toContain("RUNNING");
    expect(getFunctionExecution).toHaveBeenCalledWith(
      { workspaceId: "workspace-1", executionId: "exec-1" },
      { signal: expect.any(AbortSignal) },
    );
  });

  test("--follow --timeout aborts a poll request that never answers", async () => {
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    const getFunctionExecution = vi
      .fn()
      .mockResolvedValueOnce({
        execution: functionExecution({ status: FunctionExecution_Status.RUNNING }),
      })
      .mockImplementation(
        (_request: unknown, options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () =>
              reject(new ConnectError("deadline", Code.DeadlineExceeded)),
            );
          }),
      );
    vi.mocked(initOperatorClient).mockResolvedValue({
      getFunctionExecution,
    } as unknown as OperatorClient);

    const result = await runCommand(logsCommand, [
      "exec-1",
      "--follow",
      "--interval",
      "1ms",
      "--timeout",
      "30ms",
    ]);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("Timed out");
    expect(result.error?.message).toContain("RUNNING");
  });

  test("--follow retries transient poll errors and reports them even in JSON mode", async () => {
    using stdout = captureStdout();
    using stderr = captureStderr();
    using _json = jsonMode();
    const getFunctionExecution = vi
      .fn()
      .mockResolvedValueOnce({
        execution: functionExecution({
          status: FunctionExecution_Status.RUNNING,
          logEntries: [entries[0]!],
        }),
      })
      .mockRejectedValueOnce(new ConnectError("try later", Code.Unavailable))
      .mockResolvedValueOnce({
        execution: functionExecution({
          status: FunctionExecution_Status.SUCCESS,
          logEntries: entries,
        }),
      });
    vi.mocked(initOperatorClient).mockResolvedValue({
      getFunctionExecution,
    } as unknown as OperatorClient);

    const result = await runCommand(logsCommand, ["exec-1", "--follow", "--interval", "1ms"]);

    expect(result.success).toBe(true);
    expect(getFunctionExecution).toHaveBeenCalledTimes(3);
    expect(stripAnsi(stderr.output)).toContain("Retrying function execution poll");
    expect(JSON.parse(stdout.output).logEntries).toHaveLength(2);
  });

  test("--follow stops on a non-retryable poll error", async () => {
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    const getFunctionExecution = vi
      .fn()
      .mockResolvedValueOnce({
        execution: functionExecution({ status: FunctionExecution_Status.RUNNING }),
      })
      .mockRejectedValueOnce(new ConnectError("denied", Code.PermissionDenied));
    vi.mocked(initOperatorClient).mockResolvedValue({
      getFunctionExecution,
    } as unknown as OperatorClient);

    const result = await runCommand(logsCommand, ["exec-1", "--follow", "--interval", "1ms"]);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("denied");
    expect(getFunctionExecution).toHaveBeenCalledTimes(2);
  });

  test("--follow with --json emits the final execution once", async () => {
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();
    const getFunctionExecution = mockClient([
      functionExecution({ status: FunctionExecution_Status.RUNNING, logEntries: [entries[0]!] }),
      functionExecution({ status: FunctionExecution_Status.SUCCESS, logEntries: entries }),
    ]);

    await runCommand(logsCommand, ["exec-1", "--follow", "--interval", "1ms"]);

    expect(getFunctionExecution).toHaveBeenCalledTimes(2);
    const parsed = JSON.parse(stdout.output);
    expect(parsed.status).toBe("SUCCESS");
    expect(parsed.logEntries).toHaveLength(2);
  });

  test("--follow requires an execution id", async () => {
    using _stdout = captureStdout();
    using _stderr = captureStderr();
    const getFunctionExecution = mockClient([]);

    const result = await runCommand(logsCommand, ["--follow"]);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("--follow requires an execution ID");
    expect(getFunctionExecution).not.toHaveBeenCalled();
  });
});

describe("logs command list output", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    await runTest();
  });

  test("--json lists the default 50 executions and reports that more exist", async () => {
    using stdout = captureStdout();
    using stderr = captureStderr();
    using _json = jsonMode();
    vi.mocked(initOperatorClient).mockResolvedValue({
      listFunctionExecutions: vi.fn(async ({ pageSize }: { pageSize: number }) => ({
        executions: Array.from({ length: pageSize }, (_, index) =>
          functionExecution({ id: `exec-${index}` }),
        ),
        nextPageToken: "more",
      })),
    } as unknown as OperatorClient);

    const result = await runCommand(logsCommand, []);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toHaveLength(50);
    expect(stripAnsi(stderr.output)).toContain(
      "More results exist beyond --limit 50. Raise --limit to see more.",
    );
  });

  function mockList(executions: FunctionExecution[]): void {
    vi.mocked(initOperatorClient).mockResolvedValue({
      listFunctionExecutions: vi.fn(async () => ({ executions, nextPageToken: "" })),
    } as unknown as OperatorClient);
  }

  test("--json reports the error kind, name, and message of each execution", async () => {
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();
    mockList([
      functionExecution({ id: "exec-ok", errorKind: FunctionErrorKind.NONE }),
      functionExecution({
        id: "exec-user",
        status: FunctionExecution_Status.FAILED,
        errorKind: FunctionErrorKind.USER_RUNTIME,
        error: { name: "TypeError", message: "x is undefined" },
      }),
      functionExecution({
        id: "exec-syntax",
        status: FunctionExecution_Status.FAILED,
        errorKind: FunctionErrorKind.USER_NON_RUNTIME,
        error: { name: "SyntaxError", message: "Unexpected token '}'" },
      }),
      functionExecution({
        id: "exec-timeout",
        status: FunctionExecution_Status.FAILED,
        errorKind: FunctionErrorKind.PLATFORM,
        error: { message: "execution aborted due to timeout or cancellation" },
      }),
      functionExecution({ id: "exec-unrecorded", status: FunctionExecution_Status.FAILED }),
      functionExecution({ id: "exec-newer-kind", errorKind: 99 as FunctionErrorKind }),
    ]);

    await runCommand(logsCommand, []);

    const common = {
      scriptName: "workflow--billing.main",
      type: "JOB",
      startedAt: null,
      finishedAt: null,
    };
    expect(JSON.parse(stdout.output)).toEqual([
      {
        ...common,
        id: "exec-ok",
        status: "SUCCESS",
        errorKind: "NONE",
        errorName: null,
        errorMessage: null,
      },
      {
        ...common,
        id: "exec-user",
        status: "FAILED",
        errorKind: "USER_RUNTIME",
        errorName: "TypeError",
        errorMessage: "x is undefined",
      },
      {
        ...common,
        id: "exec-syntax",
        status: "FAILED",
        errorKind: "USER_NON_RUNTIME",
        errorName: "SyntaxError",
        errorMessage: "Unexpected token '}'",
      },
      {
        ...common,
        id: "exec-timeout",
        status: "FAILED",
        errorKind: "PLATFORM",
        errorName: null,
        errorMessage: "execution aborted due to timeout or cancellation",
      },
      {
        ...common,
        id: "exec-unrecorded",
        status: "FAILED",
        errorKind: "UNSPECIFIED",
        errorName: null,
        errorMessage: null,
      },
      {
        ...common,
        id: "exec-newer-kind",
        status: "SUCCESS",
        errorKind: "UNSPECIFIED",
        errorName: null,
        errorMessage: null,
      },
    ]);
  });

  test("shows the error kind and name in the table and leaves the message to --json", async () => {
    using stdout = captureStdoutStream();
    using _stderr = captureStderr();
    mockList([
      functionExecution({
        status: FunctionExecution_Status.FAILED,
        errorKind: FunctionErrorKind.USER_RUNTIME,
        error: { name: "TypeError", message: "x is undefined" },
      }),
    ]);

    await runCommand(logsCommand, []);

    const plain = stripAnsi(stdout.output);
    expect(plain).toContain("errorKind");
    expect(plain).toContain("USER_RUNTIME");
    expect(plain).toContain("TypeError");
    expect(plain).not.toContain("errorMessage");
    expect(plain).not.toContain("x is undefined");
  });
});
