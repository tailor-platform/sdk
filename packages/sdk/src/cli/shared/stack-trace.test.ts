import { stripVTControlCharacters } from "node:util";
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
    expect(result.frames[0]!.functionName).toBe("fn");
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

  test("parses Windows file URLs with drive letter", () => {
    const error = [
      "rpc error: code = Aborted desc = Error: test",
      "    at fn (file:///C:/Users/dev/project/bundle.js:1:100)",
    ].join("\n");

    const result = parseStackTrace(error);

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]).toEqual({
      functionName: "fn",
      file: "file:///C:/Users/dev/project/bundle.js",
      line: 1,
      column: 100,
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

  test("preserves multi-line error messages", () => {
    const error = [
      "rpc error: code = Aborted desc = Error: validation failed",
      "  - field 'name' is required",
      "  - field 'email' must be valid",
      "    at fn (file:///bundle.js:1:100)",
    ].join("\n");

    const result = parseStackTrace(error);

    expect(result.errorMessage).toBe(
      "Error: validation failed\n  - field 'name' is required\n  - field 'email' must be valid",
    );
    expect(result.frames).toHaveLength(1);
  });
});

function makeInlineSourcemapBundle(
  sourcemap: object,
  code = 'console.log("bundled code")',
): string {
  const json = JSON.stringify(sourcemap);
  const base64 = Buffer.from(json).toString("base64");
  return `${code}\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}`;
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

// output (1,0) -> source 0, line 4 (0-based: 3), col 2, name "throwError"
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
  test("identifies source file for V8-mapped frame positions via reverse lookup", () => {
    const sourcemap = makeTestSourcemap();
    const bundledCode = makeInlineSourcemapBundle(sourcemap);
    const traceMap = extractInlineSourcemap(bundledCode)!;

    // V8 already applied the sourcemap, so line:column are original source positions
    const frames: StackFrame[] = [
      { functionName: "throwError", file: "file:///bundle.js", line: 4, column: 3 },
    ];

    const result = mapStackFrames(frames, traceMap);

    expect(result).toHaveLength(1);
    expect(result[0]!.original).toEqual(frames[0]);
    expect(result[0]!.mapped).toEqual({
      source: "resolvers/error-test.ts",
      line: 4,
      column: 3,
      name: null,
    });
  });

  test("returns mapped: null when traceMap is null", () => {
    const frames: StackFrame[] = [
      { functionName: "fn", file: "file:///bundle.js", line: 1, column: 100 },
    ];

    const result = mapStackFrames(frames, null);

    expect(result).toHaveLength(1);
    expect(result[0]!.mapped).toBeNull();
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
    expect(result[0]!.mapped).toBeNull();
  });

  test("identifies correct source in multi-source bundles via round-trip validation", () => {
    // generatedPositionFor uses GREATEST_LOWER_BOUND bias by default, so it
    // returns a match whenever the queried source has any mapping on the
    // target line at an earlier column. Here utils/common.ts has an
    // unrelated mapping on line 10 at column 0, and reverse iteration would
    // hit it first for a frame at (line 10, column 4). Without round-trip
    // validation, the frame is incorrectly attributed to utils/common.ts
    // even though the actual throw site is resolvers/add.ts line 10 col 4.
    const traceMap = new TraceMap({
      version: 3,
      file: "bundle.js",
      sources: ["resolvers/add.ts", "utils/common.ts"],
      sourcesContent: [
        ["", "", "", "", "", "", "", "", "", '   throw new Error("bug");'].join("\n"),
        "export const y = 2;",
      ],
      names: [],
      // Generated line 1:
      //   col 0  ← resolvers/add.ts line 10 col 3 (actual throw)
      //   col 14 ← utils/common.ts  line 10 col 0 (unrelated same-line mapping)
      mappings: [
        [
          [0, 0, 9, 3],
          [14, 1, 9, 0],
        ],
      ],
    });

    const frames: StackFrame[] = [
      { functionName: "add", file: "file:///bundle.js", line: 10, column: 4 },
    ];

    const result = mapStackFrames(frames, traceMap);

    expect(result).toHaveLength(1);
    expect(result[0]!.mapped).not.toBeNull();
    expect(result[0]!.mapped?.source).toBe("resolvers/add.ts");
    expect(result[0]!.mapped?.line).toBe(10);
    expect(result[0]!.mapped?.column).toBe(4);
  });

  test("identifies correct source when true source is in middle of sources array", () => {
    // Exercises round-trip validation with a 3-source bundle where the
    // true user code sits in the middle of the sources array. Both the
    // entry wrapper (last, tried first in reverse iteration) and SDK
    // internals (first) have same-line mappings at different columns
    // that would false-positive without round-trip validation.
    const traceMap = new TraceMap({
      version: 3,
      file: "bundle.js",
      sources: ["sdk/internal.ts", "resolvers/target.ts", "entry-wrapper.ts"],
      sourcesContent: [
        "export const internal = 1;",
        ["", "", "", "", "          throw new Error('bug');"].join("\n"),
        "export const wrapper = 3;",
      ],
      names: [],
      // Generated line 1:
      //   col 0  ← entry-wrapper.ts   line 5 col 0  (false positive, tried first)
      //   col 10 ← resolvers/target.ts line 5 col 10 (actual throw, middle)
      //   col 20 ← sdk/internal.ts    line 5 col 0  (false positive, tried last)
      mappings: [
        [
          [0, 2, 4, 0],
          [10, 1, 4, 10],
          [20, 0, 4, 0],
        ],
      ],
    });

    const frames: StackFrame[] = [
      { functionName: "run", file: "file:///bundle.js", line: 5, column: 11 },
    ];

    const result = mapStackFrames(frames, traceMap);

    expect(result).toHaveLength(1);
    expect(result[0]!.mapped).not.toBeNull();
    expect(result[0]!.mapped?.source).toBe("resolvers/target.ts");
    expect(result[0]!.mapped?.line).toBe(5);
    expect(result[0]!.mapped?.column).toBe(11);
  });

  test("returns mapped.name as null even when sourcemap contains an original name", () => {
    // Intentional: V8 function names are already preserved in
    // frame.original.functionName, so we do not override them with the
    // original source name from the sourcemap. This test guards against
    // accidentally propagating origPos.name into mapped.name.
    const traceMap = new TraceMap({
      version: 3,
      file: "bundle.js",
      sources: ["resolvers/target.ts"],
      sourcesContent: ["function throwError() { throw new Error('x'); }"],
      names: ["throwError"],
      // Generated line 1 col 0 → source 0 line 1 col 0, name index 0
      mappings: "AAAAA",
    });

    const frames: StackFrame[] = [
      { functionName: "M", file: "file:///bundle.js", line: 1, column: 1 },
    ];

    const result = mapStackFrames(frames, traceMap);

    expect(result).toHaveLength(1);
    expect(result[0]!.mapped).not.toBeNull();
    expect(result[0]!.mapped?.name).toBeNull();
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
    const plain = stripVTControlCharacters(result);

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
    const plain = stripVTControlCharacters(result);

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
    const plain = stripVTControlCharacters(result);

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
    const plain = stripVTControlCharacters(result);

    // Should have the file path but no code snippet
    expect(plain).toContain("resolvers/error-test.ts:4:3");
  });

  test("prefixes dotfile-rooted paths with ./ so they are not mistaken for relative-path markers", () => {
    // Regression: paths like `.tailor/test-run/...` start with `.` but
    // are not `../` escapes. The display must prefix them with `./` so
    // users can tell they are cwd-relative.
    const frames: MappedStackFrame[] = [
      {
        original: { functionName: "main", file: "file:///bundle.js", line: 1, column: 1 },
        mapped: {
          source: ".tailor/test-run/test-run--add.entry.js",
          line: 16,
          column: 13,
          name: null,
        },
      },
    ];

    const result = formatMappedError("Error: test", frames, null, process.cwd());
    const plain = stripVTControlCharacters(result);

    expect(plain).toContain("./.tailor/test-run/test-run--add.entry.js:16:13");
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
    return makeInlineSourcemapBundle(
      sourcemap,
      'function M(){throw new Error("intentional error")}M();',
    );
  }

  test("returns formatted error when bundled code has inline sourcemap and error has stack trace", () => {
    const bundledCode = makeRealisticBundle();
    // V8 already applied the sourcemap, so the frame reports original source positions
    const error = [
      "rpc error: code = Aborted desc = Error: intentional error",
      "    at throwError (file:///test-run--error-test.js:4:3)",
    ].join("\n");

    const result = formatErrorWithSourcemap(error, bundledCode, "/output");

    expect(result).not.toBeNull();
    const plain = stripVTControlCharacters(result!);
    expect(plain).toContain("Error: intentional error");
    expect(plain).toContain("resolvers/error-test.ts:4:3");
    expect(plain).toContain('throw new Error("intentional error")');
  });

  test("returns null when bundled code has no inline sourcemap", () => {
    const bundledCode = 'function M(){throw new Error("test")}M();';
    const error = "rpc error: code = Aborted desc = Error: test\n    at M (file:///b.js:1:1)";

    const result = formatErrorWithSourcemap(error, bundledCode, "/output");

    expect(result).toBeNull();
  });

  test("returns null when error has no stack trace", () => {
    const bundledCode = makeRealisticBundle();
    const error = "Script execution failed with unknown error";

    const result = formatErrorWithSourcemap(error, bundledCode, "/output");

    expect(result).toBeNull();
  });
});
