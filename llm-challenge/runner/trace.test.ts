import { describe, expect, it } from "vitest";
import { parseTrace } from "./trace";

function makeLines(events: object[]): string[] {
  return events.map((e) => JSON.stringify(e));
}

describe("parseTrace", () => {
  it("groups writes per file, marks all but the last successful write as false starts", () => {
    const lines = makeLines([
      {
        type: "user",
        timestamp: "2025-11-20T01:00:00Z",
        message: { role: "user", content: "start" },
      },
      {
        type: "assistant",
        timestamp: "2025-11-20T01:00:01Z",
        message: {
          content: [
            { type: "text", text: "Working" },
            {
              type: "tool_use",
              id: "w1",
              name: "Write",
              input: { file_path: "/work/foo.ts", content: "v1\nline2\n" },
            },
          ],
        },
      },
      {
        type: "user",
        timestamp: "2025-11-20T01:00:02Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "w1", is_error: false, content: "ok" }],
        },
      },
      {
        type: "assistant",
        timestamp: "2025-11-20T01:00:03Z",
        message: {
          content: [
            {
              type: "tool_use",
              id: "w2",
              name: "Write",
              input: { file_path: "/work/foo.ts", content: "v2_bad\n" },
            },
          ],
        },
      },
      {
        type: "user",
        timestamp: "2025-11-20T01:00:04Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "w2", is_error: true, content: "denied" }],
        },
      },
      {
        type: "assistant",
        timestamp: "2025-11-20T01:00:05Z",
        message: {
          content: [
            {
              type: "tool_use",
              id: "w3",
              name: "Write",
              input: { file_path: "/work/foo.ts", content: "v3_final\nline2\n" },
            },
          ],
        },
      },
      {
        type: "user",
        timestamp: "2025-11-20T01:00:06Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "w3", content: "ok" }],
        },
      },
    ]);

    const trace = parseTrace({ lines, workDirRealPath: "/work" });
    expect(trace.files).toHaveLength(1);
    const file = trace.files[0]!;
    expect(file.filePath).toBe("foo.ts");
    expect(file.writes).toHaveLength(2);
    expect(file.writes[0]!.isFalseStart).toBe(true);
    expect(file.writes[0]!.diffSummary?.firstDifference).toContain("v1");
    expect(file.writes[1]!.isFalseStart).toBe(false);
    expect(file.writes[1]!.diffSummary).toBeUndefined();
    expect(file.falseStartCount).toBe(1);
    expect(trace.falseStartTotal).toBe(1);
  });

  it("collects edits, bash commands, and reads", () => {
    const lines = makeLines([
      {
        type: "assistant",
        timestamp: "2025-11-20T01:00:00Z",
        message: {
          content: [
            {
              type: "tool_use",
              id: "e1",
              name: "Edit",
              input: {
                file_path: "/work/bar.ts",
                old_string: "abc",
                new_string: "abcdef",
              },
            },
            {
              type: "tool_use",
              id: "b1",
              name: "Bash",
              input: { command: "pnpm test", description: "run tests" },
            },
            {
              type: "tool_use",
              id: "r1",
              name: "Read",
              input: { file_path: "/work/baz.ts" },
            },
          ],
        },
      },
    ]);

    const trace = parseTrace({ lines, workDirRealPath: "/work" });
    expect(trace.edits).toEqual([
      { ts: "2025-11-20T01:00:00Z", filePath: "bar.ts", oldStringLength: 3, newStringLength: 6 },
    ]);
    expect(trace.bashCommands).toEqual([
      { ts: "2025-11-20T01:00:00Z", command: "pnpm test", description: "run tests" },
    ]);
    expect(trace.readPaths).toEqual([{ ts: "2025-11-20T01:00:00Z", filePath: "baz.ts" }]);
    expect(trace.files).toHaveLength(0);
    expect(trace.falseStartTotal).toBe(0);
  });

  it("computes durationMs from first to last timestamped event", () => {
    const lines = makeLines([
      {
        type: "user",
        timestamp: "2025-11-20T01:00:00Z",
        message: { role: "user", content: "start" },
      },
      {
        type: "assistant",
        timestamp: "2025-11-20T01:00:10Z",
        message: { content: [{ type: "text", text: "done" }] },
      },
    ]);
    const trace = parseTrace({ lines });
    expect(trace.durationMs).toBe(10_000);
    expect(trace.assistantTextLength).toBe(4);
  });

  it("ignores unknown event types and malformed lines", () => {
    const lines = [
      JSON.stringify({ type: "permission-mode", sessionId: "x" }),
      JSON.stringify({ type: "ai-title", title: "y" }),
      "not json",
      "",
      JSON.stringify({
        type: "assistant",
        timestamp: "2025-11-20T01:00:00Z",
        message: { content: [{ type: "text", text: "hi" }] },
      }),
    ];
    const trace = parseTrace({ lines });
    expect(trace.files).toHaveLength(0);
    expect(trace.assistantTextLength).toBe(2);
  });

  it("falls back to absolute paths when workDirRealPath is not provided", () => {
    const lines = makeLines([
      {
        type: "assistant",
        timestamp: "2025-11-20T01:00:00Z",
        message: {
          content: [
            {
              type: "tool_use",
              id: "w1",
              name: "Write",
              input: { file_path: "/work/foo.ts", content: "x" },
            },
          ],
        },
      },
      {
        type: "user",
        timestamp: "2025-11-20T01:00:01Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "w1", content: "ok" }],
        },
      },
    ]);
    const trace = parseTrace({ lines });
    expect(trace.files[0]!.filePath).toBe("/work/foo.ts");
  });
});
