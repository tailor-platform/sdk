import { describe, expect, it } from "vitest";
import {
  estimateCodexMaxOutputTokens,
  interpretCodexAuthStatus,
  interpretCodexRunStatus,
  parseCodexJsonlOutput,
} from "./codex";

describe("estimateCodexMaxOutputTokens", () => {
  it("reserves a buffer from max budget", () => {
    expect(estimateCodexMaxOutputTokens(2)).toBe(160_000);
  });

  it("returns a practical minimum for very small budgets", () => {
    expect(estimateCodexMaxOutputTokens(0.0001)).toBe(32);
  });

  it("falls back to the practical minimum when budget is zero", () => {
    expect(estimateCodexMaxOutputTokens(0)).toBe(32);
  });
});

describe("parseCodexJsonlOutput", () => {
  it("returns a failure shell when input is empty", () => {
    expect(parseCodexJsonlOutput("")).toEqual({
      success: false,
      message: "",
      error: undefined,
      usage: undefined,
    });
  });

  it("returns failure when only thread.started is present (no turn.completed)", () => {
    const stdout = '{"type":"thread.started","thread_id":"abc"}';
    const result = parseCodexJsonlOutput(stdout);
    expect(result.success).toBe(false);
  });
});

describe("interpretCodexAuthStatus", () => {
  it("treats auth check as success when a turn completes even if exit code is non-zero", () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"ok"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30}}',
      '{"type":"error","message":"Failed to shutdown rollout recorder"}',
    ].join("\n");
    const stderr =
      "WARNING: proceeding, even though we could not update PATH: Operation not permitted (os error 1)";

    expect(interpretCodexAuthStatus({ code: 1, stdout, stderr })).toEqual({
      ok: true,
    });
  });

  it("returns failure when no completed turn is present", () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"turn.failed","error":{"message":"authentication failed"}}',
    ].join("\n");

    expect(interpretCodexAuthStatus({ code: 1, stdout, stderr: "" })).toEqual({
      ok: false,
      error: "authentication failed",
    });
  });
});

describe("interpretCodexRunStatus", () => {
  it("treats solve runs as success when a turn completes even if exit code is non-zero", () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"done"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30}}',
      '{"type":"error","message":"Failed to shutdown rollout recorder"}',
    ].join("\n");
    const stderr =
      "WARNING: proceeding, even though we could not update PATH: Operation not permitted (os error 1)";

    expect(
      interpretCodexRunStatus({
        code: 1,
        stdout,
        stderr,
        output: stdout,
      }),
    ).toMatchObject({
      success: true,
      message: "done",
      error: undefined,
    });
  });

  it("keeps turn.failed reason even when a trailing generic error event exists", () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"turn.failed","error":{"message":"authentication failed"}}',
      '{"type":"error","message":"Failed to shutdown rollout recorder"}',
    ].join("\n");

    expect(
      interpretCodexRunStatus({
        code: 1,
        stdout,
        stderr: "",
        output: stdout,
      }),
    ).toMatchObject({
      success: false,
      error: "authentication failed",
    });
  });
});
