import { describe, expect, it } from "vitest";
import { interpretClaudeAuthStatus, parseClaudeJsonOutput } from "./claude";

describe("interpretClaudeAuthStatus", () => {
  it("treats parsed non-error JSON as success even if exit code is non-zero", () => {
    const result = interpretClaudeAuthStatus({
      code: 1,
      stdout: JSON.stringify({
        result: "ok",
        is_error: false,
        total_cost_usd: 0,
        duration_ms: 10,
      }),
      stderr: "non-fatal warning",
    });

    expect(result).toEqual({
      ok: true,
    });
  });

  it("fails when Claude JSON output reports is_error even if exit code is zero", () => {
    const result = interpretClaudeAuthStatus({
      code: 0,
      stdout: JSON.stringify({
        result: "authentication failed",
        is_error: true,
        total_cost_usd: 0,
        duration_ms: 10,
      }),
      stderr: "",
    });

    expect(result).toEqual({
      ok: false,
      error: "authentication failed",
    });
  });

  it("fails when non-JSON stdout matches an infra failure pattern", () => {
    const result = interpretClaudeAuthStatus({
      code: 1,
      stdout: "Not logged in.",
      stderr: "",
    });

    expect(result).toEqual({
      ok: false,
      error: "Not logged in.",
    });
  });

  it("treats non-JSON output with exit code 0 and no infra pattern as success", () => {
    const result = interpretClaudeAuthStatus({
      code: 0,
      stdout: "plain text",
      stderr: "",
    });

    expect(result).toEqual({
      ok: true,
    });
  });
});

describe("parseClaudeJsonOutput", () => {
  it("parses a legacy single-object JSON output", () => {
    const output = JSON.stringify({
      result: "done",
      is_error: false,
      total_cost_usd: 0.5,
      duration_ms: 1000,
      num_turns: 2,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100 },
    });
    expect(parseClaudeJsonOutput(output)).toEqual({
      parsed: true,
      isError: false,
      result: "done",
      costUsd: 0.5,
      durationMs: 1000,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 100,
        numTurns: 2,
      },
    });
  });

  it("falls back to scanning for the result line when stream-json is fed in", () => {
    const stream = [
      JSON.stringify({ type: "system", subtype: "init", model: "sonnet" }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "ok" }] },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 5000,
        num_turns: 1,
        result: "All done!",
        total_cost_usd: 0.001,
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100 },
      }),
    ].join("\n");

    expect(parseClaudeJsonOutput(stream)).toEqual({
      parsed: true,
      isError: false,
      result: "All done!",
      costUsd: 0.001,
      durationMs: 5000,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 100,
        numTurns: 1,
      },
    });
  });

  it("returns parsed=false when no result line is present in a stream", () => {
    const stream = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: { content: [] } }),
    ].join("\n");

    expect(parseClaudeJsonOutput(stream)).toEqual({
      parsed: false,
      isError: true,
      result: stream,
      costUsd: 0,
    });
  });

  it("returns parsed=false for non-JSON garbage output", () => {
    expect(parseClaudeJsonOutput("plain text fail")).toEqual({
      parsed: false,
      isError: true,
      result: "plain text fail",
      costUsd: 0,
    });
  });
});
