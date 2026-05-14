import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type TraceEvent,
  appendTraceEvent,
  parseClaudeStreamLine,
  parseCodexStreamLine,
  parseOpencodeStreamLine,
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

describe("parseOpencodeStreamLine", () => {
  it("returns null for blank or non-JSON lines", () => {
    expect(parseOpencodeStreamLine("")).toBeNull();
    expect(parseOpencodeStreamLine("   ")).toBeNull();
    expect(parseOpencodeStreamLine("not json")).toBeNull();
    expect(parseOpencodeStreamLine("{ broken")).toBeNull();
  });

  it("returns null for ignored event types (step_start, text)", () => {
    expect(
      parseOpencodeStreamLine(
        JSON.stringify({
          type: "step_start",
          part: { type: "step-start", id: "prt_1" },
        }),
      ),
    ).toBeNull();
    expect(
      parseOpencodeStreamLine(
        JSON.stringify({
          type: "text",
          part: { type: "text", text: "hello", id: "prt_2" },
        }),
      ),
    ).toBeNull();
  });

  it("parses a write tool_use line and snake_cases input keys", () => {
    // Captured shape from opencode 1.14.50 + gpt-oss:20b smoke test (2026-05-15).
    const line = JSON.stringify({
      type: "tool_use",
      timestamp: 1778772362324,
      sessionID: "ses_abc",
      part: {
        type: "tool",
        tool: "write",
        callID: "call_xyz",
        state: {
          status: "completed",
          input: { filePath: "/workspace/hello.txt", content: "world" },
          output: "Wrote file successfully.",
        },
        id: "prt_1",
        sessionID: "ses_abc",
        messageID: "msg_1",
      },
    });
    expect(parseOpencodeStreamLine(line)).toEqual({
      kind: "tool_use",
      name: "Write",
      input: { file_path: "/workspace/hello.txt", content: "world" },
      toolUseId: "call_xyz",
    });
  });

  it("renames shell → Bash so metrics.bashRetries can match (legacy alias)", () => {
    const line = JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "shell",
        callID: "call_2",
        state: {
          status: "completed",
          input: { command: "pnpm test", description: "run tests" },
        },
      },
    });
    expect(parseOpencodeStreamLine(line)).toEqual({
      kind: "tool_use",
      name: "Bash",
      input: { command: "pnpm test", description: "run tests" },
      toolUseId: "call_2",
    });
  });

  it("renames bash → Bash (opencode 1.14.50 wire name)", () => {
    // Captured from the m01 E2E run: opencode 1.14.50 emits the shell tool
    // as `bash`, not `shell`. Without this normalisation the 14 bash calls
    // in that run all went to `toolCallCounts.bash` and bypassed
    // `BASH_RETRY_COMMANDS`.
    const line = JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "bash",
        callID: "call_2b",
        state: {
          status: "completed",
          input: { command: "pnpm typecheck" },
        },
      },
    });
    expect(parseOpencodeStreamLine(line)).toEqual({
      kind: "tool_use",
      name: "Bash",
      input: { command: "pnpm typecheck" },
      toolUseId: "call_2b",
    });
  });

  it("renames read + filePath so classifyReadTarget sees file_path", () => {
    const line = JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "read",
        callID: "call_3",
        state: {
          status: "completed",
          input: { filePath: "node_modules/@tailor-platform/sdk/dist/index.d.ts" },
        },
      },
    });
    expect(parseOpencodeStreamLine(line)).toEqual({
      kind: "tool_use",
      name: "Read",
      input: { file_path: "node_modules/@tailor-platform/sdk/dist/index.d.ts" },
      toolUseId: "call_3",
    });
  });

  it("renames edit camelCase args (oldString, newString, replaceAll) to snake_case", () => {
    const line = JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "edit",
        callID: "call_4",
        state: {
          status: "completed",
          input: {
            filePath: "/workspace/a.ts",
            oldString: "foo",
            newString: "bar",
            replaceAll: true,
          },
        },
      },
    });
    expect(parseOpencodeStreamLine(line)).toEqual({
      kind: "tool_use",
      name: "Edit",
      input: {
        file_path: "/workspace/a.ts",
        old_string: "foo",
        new_string: "bar",
        replace_all: true,
      },
      toolUseId: "call_4",
    });
  });

  it("drops intermediate states so each tool call counts once", () => {
    const partial = JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "write",
        callID: "call_5",
        state: { status: "partial-call", input: {} },
      },
    });
    expect(parseOpencodeStreamLine(partial)).toBeNull();
    const callOnly = JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "write",
        callID: "call_5",
        state: { status: "call", input: { filePath: "/x" } },
      },
    });
    expect(parseOpencodeStreamLine(callOnly)).toBeNull();
  });

  it("forwards unknown tool names verbatim (future-tool resilience)", () => {
    const line = JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "webfetch",
        callID: "call_6",
        state: {
          status: "completed",
          input: { url: "https://example.com" },
        },
      },
    });
    expect(parseOpencodeStreamLine(line)).toEqual({
      kind: "tool_use",
      name: "webfetch",
      input: { url: "https://example.com" },
      toolUseId: "call_6",
    });
  });

  it("parses step_finish as turn_summary with per-step tokens", () => {
    const line = JSON.stringify({
      type: "step_finish",
      part: {
        type: "step-finish",
        reason: "tool-calls",
        tokens: {
          total: 9379,
          input: 9303,
          output: 76,
          reasoning: 0,
          cache: { write: 0, read: 5 },
        },
        cost: 0,
      },
    });
    expect(parseOpencodeStreamLine(line)).toEqual({
      kind: "turn_summary",
      turnIndex: 0,
      inputTokens: 9303,
      outputTokens: 76,
      cacheReadTokens: 5,
    });
  });

  it("parses a reasoning event as thinking", () => {
    const line = JSON.stringify({
      type: "reasoning",
      part: { type: "reasoning", text: "Let me plan…" },
    });
    expect(parseOpencodeStreamLine(line)).toEqual({ kind: "thinking", text: "Let me plan…" });
  });

  it("also accepts 'thinking' as the envelope type (Claude convention)", () => {
    const line = JSON.stringify({
      type: "thinking",
      part: { type: "thinking", text: "step 1" },
    });
    expect(parseOpencodeStreamLine(line)).toEqual({ kind: "thinking", text: "step 1" });
  });

  it("parses an error event as a failure result with the message", () => {
    const line = JSON.stringify({
      type: "error",
      part: { message: "ollama not reachable" },
    });
    expect(parseOpencodeStreamLine(line)).toMatchObject({
      kind: "result",
      isError: true,
      text: "ollama not reachable",
      costUsd: 0,
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
