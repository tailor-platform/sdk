import { describe, expect, test } from "vitest";
import { describeFailure, parseEventFrame, splitFrames } from "./stream";

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

describe("describeFailure", () => {
  test("says what failed with its suggestion on the next line", () => {
    const error = {
      error: { message: "Workspace ID not found.", suggestion: "Pass --workspace-id." },
    };

    expect(describeFailure(error)).toBe("Workspace ID not found.\nPass --workspace-id.");
  });

  test("says just the message when there is no suggestion", () => {
    expect(describeFailure({ error: { message: "boom" } })).toBe("boom");
  });

  test("shows the envelope itself when it carries no message", () => {
    expect(describeFailure({ error: { code: "X" } })).toBe('{"error":{"code":"X"}}');
  });
});
