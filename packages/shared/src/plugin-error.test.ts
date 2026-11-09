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
    const error = new Error("failed");
    reportPluginError(error, target);
    expect(target.lines).toEqual(['{"error":{"message":"failed","stack":"trace"}}']);
    expect(target.annotations).toEqual([{ error, jsonMode: true }]);
  });

  test("keeps formatted details and a verbose stack for human output", () => {
    const target = output(false, true);
    const error = Object.assign(new Error("failed"), {
      format: () => "failed: details",
      stack: "trace",
    });
    reportPluginError(error, target);
    expect(target.lines).toEqual(["failed: details", "\nStack trace:\ntrace"]);
    expect(target.annotations).toEqual([{ error, jsonMode: false }]);
  });

  test.each([
    [new Error("failed"), "failed"],
    [{ format: "not callable" }, "Unknown error: [object Object]"],
    ["failure", "Unknown error: failure"],
  ])("prints plain errors without a stack by default: %s", (error, expected) => {
    const target = output();
    reportPluginError(error, target);
    expect(target.lines).toEqual([expected]);
  });

  test("does not report successful cleanup", () => {
    const target = output();
    reportPluginError(undefined, target);
    expect(target.lines).toEqual([]);
    expect(target.annotations).toEqual([]);
  });
});
