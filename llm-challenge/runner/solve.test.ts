import { describe, expect, it } from "vitest";
import { parseClaudeJsonOutput } from "./solver/claude";
import { estimateCodexUsageCostUsd, parseCodexJsonlOutput } from "./solver/codex";

describe("parseClaudeJsonOutput", () => {
  it("parses successful Claude JSON output", () => {
    const output = JSON.stringify({
      result: "done",
      is_error: false,
      total_cost_usd: 0.0123,
      duration_ms: 1234,
    });

    expect(parseClaudeJsonOutput(output)).toEqual({
      parsed: true,
      isError: false,
      result: "done",
      costUsd: 0.0123,
      durationMs: 1234,
    });
  });

  it("returns parsed=false for non-JSON output", () => {
    expect(parseClaudeJsonOutput("not-json")).toEqual({
      parsed: false,
      isError: true,
      result: "not-json",
      costUsd: 0,
    });
  });
});

describe("parseCodexJsonlOutput", () => {
  it("extracts final agent message and usage from successful Codex JSONL", () => {
    const output = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"implemented"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30}}',
    ].join("\n");

    expect(parseCodexJsonlOutput(output)).toEqual({
      success: true,
      message: "implemented",
      error: undefined,
      usage: {
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 30,
      },
    });
  });

  it("marks output as failure when turn.failed is present", () => {
    const output = [
      '{"type":"turn.started"}',
      '{"type":"error","message":"authentication failed"}',
      '{"type":"turn.failed","error":{"message":"authentication failed"}}',
    ].join("\n");

    expect(parseCodexJsonlOutput(output)).toEqual({
      success: false,
      message: "",
      error: "authentication failed",
      usage: undefined,
    });
  });
});

describe("estimateCodexUsageCostUsd", () => {
  it("estimates USD cost from usage", () => {
    const cost = estimateCodexUsageCostUsd({
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 30,
    });

    expect(cost).toBeCloseTo(0.0004025, 10);
  });

  it("returns 0 when usage is missing", () => {
    expect(estimateCodexUsageCostUsd(undefined)).toBe(0);
  });
});
