import { describe, expect, test } from "vitest";
import { parseFrame, splitFrames } from "./stream";

describe("splitFrames", () => {
  test("returns the complete frames and keeps the unfinished tail", () => {
    expect(splitFrames("event: a\ndata: 1\n\nevent: b\ndata: 2\n\nevent: c\ndata")).toEqual({
      frames: ["event: a\ndata: 1", "event: b\ndata: 2"],
      rest: "event: c\ndata",
    });
  });

  test("returns no frame while the first one is unfinished", () => {
    expect(splitFrames("event: a\ndata: 1\n")).toEqual({
      frames: [],
      rest: "event: a\ndata: 1\n",
    });
  });
});

describe("parseFrame", () => {
  test("reads a stdout JSON line as a run record", () => {
    const record = { success: true, functionName: "add", executionId: "e1", result: "3" };

    expect(parseFrame(`event: stdout\ndata: ${JSON.stringify(record)}`)).toEqual({
      type: "run",
      record,
    });
  });

  test("shows a stdout line that is not JSON as a note", () => {
    expect(parseFrame("event: stdout\ndata: plain output")).toEqual({
      type: "note",
      text: "plain output",
    });
  });

  test("reads a stderr JSON error as a failure with its suggestion", () => {
    const error = {
      error: { message: "Workspace ID not found.", suggestion: "Pass --workspace-id." },
    };

    expect(parseFrame(`event: stderr\ndata: ${JSON.stringify(error)}`)).toEqual({
      type: "failure",
      text: "Workspace ID not found.\nPass --workspace-id.",
    });
  });

  test("reads a stderr JSON error without a suggestion as just its message", () => {
    const error = { error: { message: "boom" } };

    expect(parseFrame(`event: stderr\ndata: ${JSON.stringify(error)}`)).toEqual({
      type: "failure",
      text: "boom",
    });
  });

  test.each([
    ["text", "Ready! Running add.ts"],
    ["JSON without an error", '{"info":"ready"}'],
  ])("shows stderr %s as a note", (_name, data) => {
    expect(parseFrame(`event: stderr\ndata: ${data}`)).toEqual({ type: "note", text: data });
  });

  test("reads the exit event", () => {
    expect(parseFrame('event: exit\ndata: {"code":0}')).toEqual({ type: "exit" });
  });

  test("joins multi-line data with newlines", () => {
    expect(parseFrame("event: stdout\ndata: first\ndata: second")).toEqual({
      type: "note",
      text: "first\nsecond",
    });
  });

  test("ignores an event it does not know", () => {
    expect(parseFrame("event: other\ndata: x")).toBeUndefined();
  });
});
