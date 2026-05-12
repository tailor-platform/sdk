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

  it("extracts usage when Claude JSON output includes per-turn token stats", () => {
    const output = JSON.stringify({
      result: "done",
      is_error: false,
      total_cost_usd: 0.05,
      duration_ms: 9000,
      num_turns: 12,
      usage: {
        input_tokens: 1500,
        output_tokens: 800,
        cache_read_input_tokens: 20000,
        cache_creation_input_tokens: 4000,
      },
    });

    expect(parseClaudeJsonOutput(output).usage).toEqual({
      inputTokens: 1500,
      outputTokens: 800,
      cacheReadTokens: 20000,
      numTurns: 12,
    });
  });

  it("omits usage when neither usage nor num_turns are present", () => {
    const output = JSON.stringify({
      result: "ok",
      is_error: false,
      total_cost_usd: 0,
      duration_ms: 0,
    });

    expect(parseClaudeJsonOutput(output).usage).toBeUndefined();
  });

  it("captures numTurns even when the usage block is missing", () => {
    const output = JSON.stringify({
      result: "ok",
      is_error: false,
      total_cost_usd: 0,
      duration_ms: 0,
      num_turns: 4,
    });

    expect(parseClaudeJsonOutput(output).usage).toEqual({ numTurns: 4 });
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
      numTurns: 1,
    });
  });

  it("counts turn.completed events across multi-turn Codex runs", () => {
    const output = [
      '{"type":"turn.started"}',
      '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"final"}}',
      '{"type":"turn.completed","usage":{"input_tokens":20,"cached_input_tokens":5,"output_tokens":7}}',
    ].join("\n");

    const parsed = parseCodexJsonlOutput(output);
    expect(parsed.numTurns).toBe(2);
    // The usage from the LAST turn wins; this is documented behavior.
    expect(parsed.usage).toEqual({ inputTokens: 20, cachedInputTokens: 5, outputTokens: 7 });
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
