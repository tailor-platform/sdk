import { TraceMap } from "@jridgewell/trace-mapping";
import { describe, test, expect } from "vitest";
import {
  parseStackTrace,
  extractInlineSourcemap,
  mapStackFrames,
  formatMappedError,
  formatErrorWithSourcemap,
  type StackFrame,
  type MappedStackFrame,
} from "./stack-trace";

// Strip ANSI escape codes for plain-text assertions
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("parseStackTrace", () => {
  test("parses standard V8 stack trace with rpc error prefix", () => {
    const error = [
      "rpc error: code = Aborted desc = Error: intentional executor error",
      "    at M (file:///test-run--error-test.js:1:12192)",
      "    at Object.body (file:///test-run--error-test.js:1:12349)",
      "    at I (file:///test-run--error-test.js:1:12594)",
      "    at <eval>:17:38",
    ].join("\n");

    const result = parseStackTrace(error);

    expect(result.errorMessage).toBe("Error: intentional executor error");
    expect(result.frames).toHaveLength(3);
    expect(result.frames[0]).toEqual({
      functionName: "M",
      file: "file:///test-run--error-test.js",
      line: 1,
      column: 12192,
    });
    expect(result.frames[1]).toEqual({
      functionName: "Object.body",
      file: "file:///test-run--error-test.js",
      line: 1,
      column: 12349,
    });
    expect(result.frames[2]).toEqual({
      functionName: "I",
      file: "file:///test-run--error-test.js",
      line: 1,
      column: 12594,
    });
  });

  test("skips eval frames without file:/// prefix", () => {
    const error = [
      "rpc error: code = Aborted desc = TypeError: undefined is not a function",
      "    at fn (file:///bundle.js:1:100)",
      "    at <eval>:17:38",
    ].join("\n");

    const result = parseStackTrace(error);

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0].functionName).toBe("fn");
  });

  test("returns empty frames for error without stack trace", () => {
    const error = "Script execution failed with unknown error";

    const result = parseStackTrace(error);

    expect(result.errorMessage).toBe("Script execution failed with unknown error");
    expect(result.frames).toHaveLength(0);
  });

  test("parses anonymous function frames (no function name)", () => {
    const error = [
      "rpc error: code = Aborted desc = Error: test",
      "    at file:///bundle.js:1:500",
    ].join("\n");

    const result = parseStackTrace(error);

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]).toEqual({
      functionName: "<anonymous>",
      file: "file:///bundle.js",
      line: 1,
      column: 500,
    });
  });

  test("strips rpc error prefix from error message", () => {
    const error =
      "rpc error: code = Aborted desc = RangeError: out of bounds\n    at fn (file:///b.js:1:1)";

    const result = parseStackTrace(error);

    expect(result.errorMessage).toBe("RangeError: out of bounds");
  });

  test("preserves error message without rpc prefix", () => {
    const error = "Error: simple error\n    at fn (file:///b.js:1:1)";

    const result = parseStackTrace(error);

    expect(result.errorMessage).toBe("Error: simple error");
  });
});

// Helper to create a minimal sourcemap and encode it inline
function makeInlineSourcemapBundle(sourcemap: object): string {
  const json = JSON.stringify(sourcemap);
  const base64 = Buffer.from(json).toString("base64");
  return `console.log("bundled code");\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}`;
}

describe("extractInlineSourcemap", () => {
  test("extracts TraceMap from inline sourcemap in bundled code", () => {
    const sourcemap = {
      version: 3,
      sources: ["original.ts"],
      sourcesContent: ['throw new Error("test");'],
      names: [],
      mappings: "AAAA",
    };
    const bundledCode = makeInlineSourcemapBundle(sourcemap);

    const traceMap = extractInlineSourcemap(bundledCode);

    expect(traceMap).not.toBeNull();
  });

  test("returns null when no inline sourcemap is present", () => {
    const bundledCode = 'console.log("no sourcemap here");';

    const traceMap = extractInlineSourcemap(bundledCode);

    expect(traceMap).toBeNull();
  });

  test("returns null for invalid base64 data", () => {
    const bundledCode =
      'console.log("test");\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,!!!invalid!!!';

    const traceMap = extractInlineSourcemap(bundledCode);

    expect(traceMap).toBeNull();
  });
});

// Realistic sourcemap: output line 1, col 0 -> original.ts line 3, col 4
// The VLQ "AAGC" means: (0,0) -> (source 0, line 3 (delta +2 from implicit 0), col 4 (delta +2))
// Actually let's construct it properly using known VLQ segments:
// We need: genCol=0, source=0, origLine=2(0-based for line 3), origCol=4, name=0
// VLQ: genCol=0->A, source=0->A, origLine=2->E, origCol=4->I, name=0->A = "AAEIA"
function makeTestSourcemap(): object {
  return {
    version: 3,
    sources: ["resolvers/error-test.ts"],
    sourcesContent: [
      [
        'import { createResolver } from "@tailor-platform/sdk";',
        "",
        "function throwError() {",
        '  throw new Error("intentional error");',
        "}",
        "",
        "export default createResolver({",
        "  body: async (context) => {",
        "    throwError();",
        "  },",
        "});",
      ].join("\n"),
    ],
    names: ["throwError"],
    // output line 1 col 0 -> source 0 line 4 (0-based: 3) col 2, name "throwError"
    mappings: "AAGEA",
  };
}

describe("mapStackFrames", () => {
  test("maps frames to original source positions via sourcemap", () => {
    const sourcemap = makeTestSourcemap();
    const bundledCode = makeInlineSourcemapBundle(sourcemap);
    const traceMap = extractInlineSourcemap(bundledCode)!;

    const frames: StackFrame[] = [
      { functionName: "M", file: "file:///bundle.js", line: 1, column: 1 },
    ];

    const result = mapStackFrames(frames, traceMap);

    expect(result).toHaveLength(1);
    expect(result[0].original).toEqual(frames[0]);
    expect(result[0].mapped).not.toBeNull();
    expect(result[0].mapped!.source).toBe("resolvers/error-test.ts");
    expect(result[0].mapped!.line).toBe(4);
    expect(result[0].mapped!.name).toBe("throwError");
  });

  test("returns mapped: null when traceMap is null", () => {
    const frames: StackFrame[] = [
      { functionName: "fn", file: "file:///bundle.js", line: 1, column: 100 },
    ];

    const result = mapStackFrames(frames, null);

    expect(result).toHaveLength(1);
    expect(result[0].mapped).toBeNull();
  });

  test("returns mapped: null when sourcemap has no mapping for position", () => {
    const sourcemap = {
      version: 3,
      sources: ["original.ts"],
      sourcesContent: ["x"],
      names: [],
      mappings: "", // Empty mappings
    };
    const bundledCode = makeInlineSourcemapBundle(sourcemap);
    const traceMap = extractInlineSourcemap(bundledCode)!;

    const frames: StackFrame[] = [
      { functionName: "fn", file: "file:///bundle.js", line: 1, column: 999 },
    ];

    const result = mapStackFrames(frames, traceMap);

    expect(result).toHaveLength(1);
    expect(result[0].mapped).toBeNull();
  });
});

describe("formatMappedError", () => {
  const sourceContent = [
    'import { createResolver } from "@tailor-platform/sdk";',
    "",
    "function throwError() {",
    '  throw new Error("intentional error");',
    "}",
    "",
    "export default createResolver({",
    "  body: async (context) => {",
    "    throwError();",
    "  },",
    "});",
  ].join("\n");

  test("formats error message with mapped source location and code snippet", () => {
    const frames: MappedStackFrame[] = [
      {
        original: { functionName: "M", file: "file:///bundle.js", line: 1, column: 100 },
        mapped: { source: "resolvers/error-test.ts", line: 4, column: 3, name: "throwError" },
      },
    ];

    const traceMap = new TraceMap({
      version: 3,
      sources: ["resolvers/error-test.ts"],
      sourcesContent: [sourceContent],
      names: [],
      mappings: "",
    });

    const result = formatMappedError("Error: intentional error", frames, traceMap);
    const plain = stripAnsi(result);

    // Should contain the error message
    expect(plain).toContain("Error: intentional error");
    // Should contain the mapped file path with line:col (clickable in terminal)
    expect(plain).toContain("resolvers/error-test.ts:4:3");
    // Should contain the error line from source
    expect(plain).toContain('throw new Error("intentional error")');
    // Should contain the > marker on the error line
    expect(plain).toContain("> 4");
  });

  test("formats multiple frames", () => {
    const frames: MappedStackFrame[] = [
      {
        original: { functionName: "M", file: "file:///bundle.js", line: 1, column: 100 },
        mapped: { source: "resolvers/error-test.ts", line: 4, column: 3, name: "throwError" },
      },
      {
        original: { functionName: "Object.body", file: "file:///bundle.js", line: 1, column: 200 },
        mapped: { source: "resolvers/error-test.ts", line: 9, column: 5, name: null },
      },
    ];

    const traceMap = new TraceMap({
      version: 3,
      sources: ["resolvers/error-test.ts"],
      sourcesContent: [sourceContent],
      names: [],
      mappings: "",
    });

    const result = formatMappedError("Error: test", frames, traceMap);
    const plain = stripAnsi(result);

    expect(plain).toContain("resolvers/error-test.ts:4:3");
    expect(plain).toContain("resolvers/error-test.ts:9:5");
  });

  test("shows unmapped frames with dim original info", () => {
    const frames: MappedStackFrame[] = [
      {
        original: { functionName: "fn", file: "file:///bundle.js", line: 1, column: 100 },
        mapped: null,
      },
    ];

    const result = formatMappedError("Error: test", frames, null);
    const plain = stripAnsi(result);

    // Should still contain the error message
    expect(plain).toContain("Error: test");
    // Should contain the original frame info
    expect(plain).toContain("bundle.js:1:100");
  });

  test("handles frames without source content (no snippet)", () => {
    const frames: MappedStackFrame[] = [
      {
        original: { functionName: "M", file: "file:///bundle.js", line: 1, column: 100 },
        mapped: { source: "resolvers/error-test.ts", line: 4, column: 3, name: null },
      },
    ];

    const traceMap = new TraceMap({
      version: 3,
      sources: ["resolvers/error-test.ts"],
      sourcesContent: [null as unknown as string],
      names: [],
      mappings: "",
    });

    const result = formatMappedError("Error: test", frames, traceMap);
    const plain = stripAnsi(result);

    // Should have the file path but no code snippet
    expect(plain).toContain("resolvers/error-test.ts:4:3");
  });
});

describe("formatErrorWithSourcemap", () => {
  const sourceContent = [
    'import { createResolver } from "@tailor-platform/sdk";',
    "",
    "function throwError() {",
    '  throw new Error("intentional error");',
    "}",
  ].join("\n");

  // Build a sourcemap that maps output line 1, col 0 -> source line 4, col 2
  function makeRealisticBundle(): string {
    const sourcemap = {
      version: 3,
      sources: ["resolvers/error-test.ts"],
      sourcesContent: [sourceContent],
      names: ["throwError"],
      // output (1,0) -> source 0, line 3 (0-based), col 2, name 0
      mappings: "AAGEA",
    };
    const code = 'function M(){throw new Error("intentional error")}M();';
    const json = JSON.stringify(sourcemap);
    const base64 = Buffer.from(json).toString("base64");
    return `${code}\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}`;
  }

  test("returns formatted error when bundled code has inline sourcemap and error has stack trace", () => {
    const bundledCode = makeRealisticBundle();
    const error = [
      "rpc error: code = Aborted desc = Error: intentional error",
      "    at M (file:///test-run--error-test.js:1:1)",
    ].join("\n");

    const result = formatErrorWithSourcemap(error, bundledCode);

    expect(result).not.toBeNull();
    const plain = stripAnsi(result!);
    expect(plain).toContain("Error: intentional error");
    expect(plain).toContain("resolvers/error-test.ts:4:3");
    expect(plain).toContain('throw new Error("intentional error")');
  });

  test("returns null when bundled code has no inline sourcemap", () => {
    const bundledCode = 'function M(){throw new Error("test")}M();';
    const error = "rpc error: code = Aborted desc = Error: test\n    at M (file:///b.js:1:1)";

    const result = formatErrorWithSourcemap(error, bundledCode);

    expect(result).toBeNull();
  });

  test("returns null when error has no stack trace", () => {
    const bundledCode = makeRealisticBundle();
    const error = "Script execution failed with unknown error";

    const result = formatErrorWithSourcemap(error, bundledCode);

    expect(result).toBeNull();
  });
});
