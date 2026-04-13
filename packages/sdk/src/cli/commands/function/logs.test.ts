import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, test, expect, vi } from "vitest";
import {
  composeExecutionErrorString,
  downloadScriptForMapping,
  formatExecutionError,
} from "./logs";
import type { OperatorClient } from "@/cli/shared/client";

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

// Strip ANSI escape codes for plain-text assertions
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
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
    const plain = stripAnsi(result);

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
    const plain = stripAnsi(result);

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
    const plain = stripAnsi(result);

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
    const plain = stripAnsi(result);

    expect(plain).toContain("ValidationError: name is required");
  });

  test("falls back to plain text when bundle has no inline sourcemap", () => {
    const error = {
      name: "Error",
      message: "boom",
      stackTrace: "Error: boom\n    at fn (file:///b.js:1:1)",
    };

    const result = formatExecutionError(error, "// no sourcemap here\nconsole.log('x');");
    const plain = stripAnsi(result);

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
    const plain = stripAnsi(result);

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
      executionStartedAt: new Date("2024-01-01T00:00:00Z"),
    });

    expect(result).toBeNull();
    expect(client.downloadFunctionRegistryScript).not.toHaveBeenCalled();
  });

  test("returns code when registry updatedAt is not newer than executionStartedAt", async () => {
    const client = makeDownloadClient([new TextEncoder().encode("code")], {
      updatedAt: new Date("2024-01-01T00:00:00Z"),
    });

    const result = await downloadScriptForMapping({
      client,
      workspaceId: "ws-1",
      scriptName: "my-resolver.throwError.body.js",
      executionStartedAt: new Date("2024-02-01T00:00:00Z"),
    });

    expect(result).toBe("code");
  });

  test("returns null when registry updatedAt is strictly newer than executionStartedAt", async () => {
    // Registry was redeployed at 2024-03-01, but the execution we are
    // viewing started at 2024-02-01. Mapping the old stack trace
    // against the new bundle would show misleading source locations.
    const client = makeDownloadClient([new TextEncoder().encode("new-code")], {
      updatedAt: new Date("2024-03-01T00:00:00Z"),
    });

    const result = await downloadScriptForMapping({
      client,
      workspaceId: "ws-1",
      scriptName: "my-resolver.throwError.body.js",
      executionStartedAt: new Date("2024-02-01T00:00:00Z"),
    });

    expect(result).toBeNull();
  });

  test("returns code when executionStartedAt is null (no staleness check possible)", async () => {
    const client = makeDownloadClient([new TextEncoder().encode("code")], {
      updatedAt: new Date("2024-03-01T00:00:00Z"),
    });

    const result = await downloadScriptForMapping({
      client,
      workspaceId: "ws-1",
      scriptName: "my-resolver.throwError.body.js",
      executionStartedAt: null,
    });

    expect(result).toBe("code");
  });

  test("returns code when registry metadata omits updatedAt", async () => {
    const client = makeDownloadClient([new TextEncoder().encode("code")]);

    const result = await downloadScriptForMapping({
      client,
      workspaceId: "ws-1",
      scriptName: "my-resolver.throwError.body.js",
      executionStartedAt: new Date("2024-02-01T00:00:00Z"),
    });

    expect(result).toBe("code");
  });

  test("returns null when download yields no chunks", async () => {
    const client = makeDownloadClient([], { updatedAt: new Date("2024-01-01T00:00:00Z") });

    const result = await downloadScriptForMapping({
      client,
      workspaceId: "ws-1",
      scriptName: "my-resolver.throwError.body.js",
      executionStartedAt: new Date("2024-02-01T00:00:00Z"),
    });

    expect(result).toBeNull();
  });
});
