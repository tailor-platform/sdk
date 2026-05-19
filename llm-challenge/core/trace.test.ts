import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TraceEvent, appendTraceEvent, parseCodexStreamLine } from "./trace";

describe("parseCodexStreamLine", () => {
  it("returns null for blank or non-JSON lines", () => {
    expect(parseCodexStreamLine("")).toBeNull();
    expect(parseCodexStreamLine("   ")).toBeNull();
    expect(parseCodexStreamLine("not json")).toBeNull();
    expect(parseCodexStreamLine("{ broken")).toBeNull();
  });

  it("returns null for envelopes the parser intentionally drops", () => {
    // thread.started / turn.started / item.started / item.updated all carry
    // no aggregatable signal and would double-count if mapped to tool_use.
    expect(
      parseCodexStreamLine(JSON.stringify({ type: "thread.started", thread_id: "t_1" })),
    ).toBeNull();
    expect(parseCodexStreamLine(JSON.stringify({ type: "turn.started" }))).toBeNull();
    expect(
      parseCodexStreamLine(
        JSON.stringify({
          type: "item.started",
          item: { id: "it_1", type: "command_execution", command: "ls" },
        }),
      ),
    ).toBeNull();
  });

  it("maps command_execution onto a Bash tool_use so BASH_RETRY_COMMANDS still match", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        id: "it_2",
        type: "command_execution",
        command: "pnpm test",
        status: "completed",
      },
    });
    expect(parseCodexStreamLine(line)).toEqual({
      kind: "tool_use",
      name: "Bash",
      input: { command: "pnpm test" },
      toolUseId: "it_2",
    });
  });

  it("maps file_change onto an Edit tool_use with file_path so classifyReadTarget sees it", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        id: "it_3",
        type: "file_change",
        path: "/workspace/tailordb/user.ts",
        changes: "+ name: db.string().required()",
        status: "completed",
      },
    });
    expect(parseCodexStreamLine(line)).toEqual({
      kind: "tool_use",
      name: "Edit",
      input: {
        file_path: "/workspace/tailordb/user.ts",
        changes: "+ name: db.string().required()",
      },
      toolUseId: "it_3",
    });
  });

  it("forwards mcp_tool_call verbatim so unknown tools register as themselves", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: {
        id: "it_4",
        type: "mcp_tool_call",
        tool: "tailor-docs.search",
        arguments: { query: "executor trigger" },
      },
    });
    expect(parseCodexStreamLine(line)).toEqual({
      kind: "tool_use",
      name: "tailor-docs.search",
      input: { query: "executor trigger" },
      toolUseId: "it_4",
    });
  });

  it("maps web_search onto a WebSearch tool_use carrying the query", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { id: "it_5", type: "web_search", text: "tailor sdk workflow trigger" },
    });
    expect(parseCodexStreamLine(line)).toEqual({
      kind: "tool_use",
      name: "WebSearch",
      input: { query: "tailor sdk workflow trigger" },
      toolUseId: "it_5",
    });
  });

  it("maps reasoning onto thinking", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { id: "it_6", type: "reasoning", text: "Plan: edit user.ts." },
    });
    expect(parseCodexStreamLine(line)).toEqual({ kind: "thinking", text: "Plan: edit user.ts." });
  });

  it("drops agent_message and plan_update so the adapter owns final text", () => {
    // The adapter sniffs agent_message separately to populate ResultEvent.text;
    // the parser must not double-emit it as a thinking/result event.
    const agent = JSON.stringify({
      type: "item.completed",
      item: { id: "it_7", type: "agent_message", text: "All done." },
    });
    expect(parseCodexStreamLine(agent)).toBeNull();
    const plan = JSON.stringify({
      type: "item.completed",
      item: { id: "it_8", type: "plan_update", text: "1. add field\n2. run tests" },
    });
    expect(parseCodexStreamLine(plan)).toBeNull();
  });

  it("parses turn.completed usage into TurnSummaryEvent with canonical names", () => {
    const line = JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 9303,
        cached_input_tokens: 5,
        output_tokens: 76,
        reasoning_output_tokens: 220,
      },
    });
    expect(parseCodexStreamLine(line)).toEqual({
      kind: "turn_summary",
      turnIndex: 0,
      inputTokens: 9303,
      outputTokens: 76,
      cacheReadTokens: 5,
    });
  });

  it("surfaces turn.failed as a failure result", () => {
    expect(parseCodexStreamLine(JSON.stringify({ type: "turn.failed" }))).toMatchObject({
      kind: "result",
      isError: true,
      text: "turn.failed",
    });
  });

  it("surfaces error envelopes as a failure result with the message", () => {
    const line = JSON.stringify({ type: "error", message: "rate limit exceeded" });
    expect(parseCodexStreamLine(line)).toMatchObject({
      kind: "result",
      isError: true,
      text: "rate limit exceeded",
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
      { kind: "tool_use", name: "Bash", input: { command: "pnpm test" } },
      { kind: "thinking", text: "x" },
      { kind: "result", isError: false, text: "ok" },
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
