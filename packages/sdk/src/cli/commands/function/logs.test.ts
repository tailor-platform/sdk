import { describe, test, expect } from "vitest";
import { composeExecutionErrorString, formatExecutionError } from "./logs";

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
