import { describe, expect, test } from "vitest";
import { reportPluginError } from "./plugin-error";

function output(jsonMode = false, verbose = false) {
  const lines: string[] = [];
  const annotations: unknown[] = [];
  return {
    lines,
    annotations,
    logger: {
      jsonMode,
      verbose,
      log: (message: string) => lines.push(message),
      error: (message: string) => lines.push(message),
      debug: (message: string) => {
        if (verbose) lines.push(message);
      },
    },
    locatedMessage: (error: Error) => error.message,
    serializeError: (_error: unknown, options: { includeStack: boolean }) =>
      JSON.stringify({
        error: { message: "failed", ...(options.includeStack && { stack: "trace" }) },
      }),
    annotateTerminalError: (error: unknown, options: { jsonMode: boolean }) =>
      annotations.push({ error, ...options }),
  };
}

describe("plugin errors", () => {
  test("keeps verbose JSON on one line and passes its mode to annotations", () => {
    const target = output(true, true);
    const error = Object.assign(new Error("failed"), { format: () => "custom report" });
    reportPluginError(error, target);
    expect(target.lines).toEqual(['{"error":{"message":"failed","stack":"trace"}}']);
    expect(target.annotations).toEqual([{ error, jsonMode: true }]);
  });

  test("keeps formatted details and a verbose stack for human output", () => {
    const target = output(false, true);
    const error = Object.assign(new Error("failed"), {
      format(this: Error) {
        return `${this.message}: details`;
      },
      stack: "trace",
    });
    reportPluginError(error, target);
    expect(target.lines).toEqual(["failed: details", "\nStack trace:\ntrace"]);
    expect(target.annotations).toEqual([{ error, jsonMode: false }]);
  });

  test.each([
    [new Error("failed"), "failed"],
    ["failure", "Unknown error: failure"],
  ])("prints plain errors without a stack by default: %s", (error, expected) => {
    const target = output();
    reportPluginError(error, target);
    expect(target.lines).toEqual([expected]);
  });

  test("falls back to the located message when format returns a non-string", () => {
    const target = { ...output(), locatedMessage: () => "config.ts: failed" };
    const error = Object.assign(new Error("failed"), { format: () => ({ _errors: [] }) });
    reportPluginError(error, target);
    expect(target.lines).toEqual(["config.ts: failed"]);
  });

  test("does not report successful cleanup", () => {
    const target = output();
    reportPluginError(undefined, target);
    expect(target.lines).toEqual([]);
    expect(target.annotations).toEqual([]);
  });
});
