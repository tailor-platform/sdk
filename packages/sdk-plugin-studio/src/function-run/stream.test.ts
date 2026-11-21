import { describe, expect, test } from "vitest";
import { interpret, parseEventFrame, splitFrames } from "./stream";

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

describe("parseEventFrame", () => {
  test("reads the event name and data of a frame", () => {
    expect(parseEventFrame('event: message\ndata: {"a":1}')).toEqual({
      event: "message",
      data: '{"a":1}',
    });
  });

  test("joins multi-line data with newlines and defaults the event to message", () => {
    expect(parseEventFrame("data: first\ndata: second")).toEqual({
      event: "message",
      data: "first\nsecond",
    });
  });
});

describe("interpret", () => {
  test("reads a stdout JSON line as a run record", () => {
    const record = { success: true, functionName: "add", executionId: "e1", result: "3" };

    expect(interpret("stdout", JSON.stringify(record))).toEqual({ type: "run", record });
  });

  test("shows a stdout line that is not JSON as a note", () => {
    expect(interpret("stdout", "plain output")).toEqual({ type: "note", text: "plain output" });
  });

  test("reads a stderr JSON error as a failure with its suggestion", () => {
    const error = {
      error: { message: "Workspace ID not found.", suggestion: "Pass --workspace-id." },
    };

    expect(interpret("stderr", JSON.stringify(error))).toEqual({
      type: "failure",
      text: "Workspace ID not found.\nPass --workspace-id.",
    });
  });

  test("reads a stderr JSON error without a suggestion as just its message", () => {
    expect(interpret("stderr", JSON.stringify({ error: { message: "boom" } }))).toEqual({
      type: "failure",
      text: "boom",
    });
  });

  test.each([
    ["text", "Ready! Running add.ts"],
    ["JSON without an error", '{"info":"ready"}'],
  ])("shows stderr %s as a note", (_name, data) => {
    expect(interpret("stderr", data)).toEqual({ type: "note", text: data });
  });

  test("reads the exit event", () => {
    expect(interpret("exit", '{"code":0}')).toEqual({ type: "exit" });
  });

  test("ignores an event it does not know", () => {
    expect(interpret("other", "x")).toBeUndefined();
  });
});
