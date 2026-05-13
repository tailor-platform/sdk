import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type TraceEvent,
  appendTraceEvent,
  parseClaudeStreamLine,
  parseCodexStreamLine,
} from "./trace";

describe("parseClaudeStreamLine", () => {
  it("returns null for blank or non-JSON lines", () => {
    expect(parseClaudeStreamLine("")).toBeNull();
    expect(parseClaudeStreamLine("   ")).toBeNull();
    expect(parseClaudeStreamLine("not json")).toBeNull();
    expect(parseClaudeStreamLine("{ broken")).toBeNull();
  });

  it("returns null for system envelopes (hooks, init, rate_limit_event)", () => {
    const init = JSON.stringify({ type: "system", subtype: "init", cwd: "/tmp" });
    expect(parseClaudeStreamLine(init)).toBeNull();
    const hook = JSON.stringify({ type: "system", subtype: "hook_started" });
    expect(parseClaudeStreamLine(hook)).toBeNull();
    const rateLimit = JSON.stringify({ type: "rate_limit_event" });
    expect(parseClaudeStreamLine(rateLimit)).toBeNull();
  });

  it("parses an assistant tool_use line", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_abc",
            name: "Bash",
            input: { command: "ls", description: "list" },
          },
        ],
        usage: { input_tokens: 5, output_tokens: 10 },
      },
    });
    const event = parseClaudeStreamLine(line);
    expect(event).toEqual({
      kind: "tool_use",
      name: "Bash",
      input: { command: "ls", description: "list" },
      toolUseId: "toolu_abc",
    });
  });

  it("prefers tool_use over thinking when both appear in one message", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "Let me list the files." },
          { type: "tool_use", id: "x", name: "Bash", input: { command: "ls" } },
        ],
      },
    });
    expect(parseClaudeStreamLine(line)).toMatchObject({ kind: "tool_use", name: "Bash" });
  });

  it("parses a pure thinking line", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "step 1" }] },
    });
    expect(parseClaudeStreamLine(line)).toEqual({ kind: "thinking", text: "step 1" });
  });

  it("parses a pure text assistant line as turn_summary with usage", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "done" }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 12000,
        },
      },
    });
    expect(parseClaudeStreamLine(line)).toEqual({
      kind: "turn_summary",
      turnIndex: 0,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 12000,
    });
  });

  it("parses a user tool_result line", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "toolu_abc", is_error: false, content: "..." },
        ],
      },
    });
    expect(parseClaudeStreamLine(line)).toEqual({
      kind: "tool_result",
      ok: true,
      toolUseId: "toolu_abc",
    });
  });

  it("flags is_error: true as ok=false in tool_result", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "x", is_error: true, content: "fail" }],
      },
    });
    expect(parseClaudeStreamLine(line)).toMatchObject({ kind: "tool_result", ok: false });
  });

  it("parses a result line with cost and usage", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 5476,
      num_turns: 2,
      result: "all good",
      total_cost_usd: 0.0818,
      usage: {
        input_tokens: 3,
        output_tokens: 200,
        cache_read_input_tokens: 17827,
      },
    });
    expect(parseClaudeStreamLine(line)).toEqual({
      kind: "result",
      isError: false,
      text: "all good",
      costUsd: 0.0818,
      durationMs: 5476,
      numTurns: 2,
      inputTokens: 3,
      outputTokens: 200,
      cacheReadTokens: 17827,
    });
  });

  it("captures is_error true on the final result event", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error_max_budget_usd",
      is_error: true,
      total_cost_usd: 0.28,
      num_turns: 1,
    });
    expect(parseClaudeStreamLine(line)).toMatchObject({ kind: "result", isError: true });
  });
});

describe("parseCodexStreamLine", () => {
  it("returns null for blank/garbage lines", () => {
    expect(parseCodexStreamLine("")).toBeNull();
    expect(parseCodexStreamLine("\n")).toBeNull();
    expect(parseCodexStreamLine("not json")).toBeNull();
  });

  it("returns null for thread.started and turn.started", () => {
    expect(parseCodexStreamLine(JSON.stringify({ type: "thread.started" }))).toBeNull();
    expect(parseCodexStreamLine(JSON.stringify({ type: "turn.started" }))).toBeNull();
  });

  it("parses an agent_message item.completed as a turn_summary marker", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "done" },
    });
    expect(parseCodexStreamLine(line)).toMatchObject({ kind: "turn_summary", turnIndex: 0 });
  });

  it("parses a reasoning item.completed as thinking", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "reasoning", text: "let me consider" },
    });
    expect(parseCodexStreamLine(line)).toEqual({ kind: "thinking", text: "let me consider" });
  });

  it("parses a command_execution item.completed as Bash tool_use", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "command_execution", id: "cmd_1", command: "ls /tmp" },
    });
    expect(parseCodexStreamLine(line)).toEqual({
      kind: "tool_use",
      name: "Bash",
      input: { command: "ls /tmp" },
      toolUseId: "cmd_1",
    });
  });

  it("parses a turn.completed as a usage-only result", () => {
    const line = JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30 },
    });
    expect(parseCodexStreamLine(line)).toEqual({
      kind: "result",
      isError: false,
      text: "",
      costUsd: 0,
      inputTokens: 100,
      outputTokens: 30,
      cacheReadTokens: 20,
    });
  });

  it("parses a turn.failed as an error result", () => {
    const line = JSON.stringify({
      type: "turn.failed",
      error: { message: "authentication failed" },
    });
    expect(parseCodexStreamLine(line)).toMatchObject({
      kind: "result",
      isError: true,
      text: "authentication failed",
    });
  });
});

describe("appendTraceEvent", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-trace-append-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("appends one JSON event per line", async () => {
    const tracePath = path.join(tempDir, "trace.jsonl");
    const events: TraceEvent[] = [
      { kind: "tool_use", name: "Read", input: { file_path: "a.ts" } },
      { kind: "thinking", text: "x" },
      { kind: "result", isError: false, text: "ok", costUsd: 0.1 },
    ];
    for (const e of events) {
      await appendTraceEvent(tracePath, e);
    }
    const lines = fs.readFileSync(tracePath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toEqual(events[0]);
    expect(JSON.parse(lines[2]!)).toEqual(events[2]);
  });
});
