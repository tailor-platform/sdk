import fs from "node:fs";

/**
 * Discriminated union of behaviour-trace events surfaced from agent CLI output.
 *
 * The shape is intentionally minimal: only the fields the metrics aggregator
 * (and a future LLM-as-judge) actually inspect. Stream payloads carry far
 * more (`session_id`, `parent_tool_use_id`, signatures, …) but we drop them
 * here to keep JSONL files small and easy to grep.
 */
export type TraceEvent =
  | ToolUseEvent
  | ToolResultEvent
  | ThinkingEvent
  | TurnSummaryEvent
  | ResultEvent;

export type ToolUseEvent = {
  kind: "tool_use";
  /** Tool name (e.g. "Read", "Bash", "Edit"). */
  name: string;
  /** Tool input args. Shape is tool-specific; we forward it verbatim. */
  input: Record<string, unknown>;
  /** Optional tool-call identifier; useful when correlating with tool_result. */
  toolUseId?: string;
};

export type ToolResultEvent = {
  kind: "tool_result";
  /** Tool name when recoverable; some streams omit it on the result side. */
  name?: string;
  /** Whether the tool call succeeded (false when the runtime flagged an error). */
  ok: boolean;
  /** Optional tool-call identifier matching the prior tool_use. */
  toolUseId?: string;
};

export type ThinkingEvent = {
  kind: "thinking";
  /** Raw thinking text emitted by the assistant. */
  text: string;
};

export type TurnSummaryEvent = {
  kind: "turn_summary";
  /** 0-based index counting assistant messages seen so far. */
  turnIndex: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
};

export type ResultEvent = {
  kind: "result";
  /** Final `is_error` flag (Claude) or success indicator (Codex). */
  isError: boolean;
  /** Final assistant message (`result` text for Claude, last `agent_message` for Codex). */
  text: string;
  costUsd: number;
  durationMs?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
};

type ClaudeAssistantContent = {
  type?: unknown;
  name?: unknown;
  input?: unknown;
  id?: unknown;
  text?: unknown;
  thinking?: unknown;
};

type ClaudeAssistantMessage = {
  content?: unknown;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cache_read_input_tokens?: unknown;
    cache_creation_input_tokens?: unknown;
  };
};

type ClaudeUserContent = {
  type?: unknown;
  tool_use_id?: unknown;
  is_error?: unknown;
  content?: unknown;
};

type ClaudeStreamEnvelope = {
  type?: unknown;
  message?: unknown;
  result?: unknown;
  is_error?: unknown;
  total_cost_usd?: unknown;
  duration_ms?: unknown;
  num_turns?: unknown;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cache_read_input_tokens?: unknown;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pickNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Parse a single line of Claude Code's `--output-format stream-json` output.
 *
 * The Claude CLI emits one JSON object per line with envelope shapes like:
 *   {"type":"assistant","message":{"content":[{"type":"text"|"thinking"|"tool_use",...}], "usage":{...}}}
 *   {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":...,"is_error":...}]}}
 *   {"type":"result","is_error":false,"total_cost_usd":...,"num_turns":...,"result":"..."}
 *
 * `assistant` messages can carry multiple content items in a single envelope
 * (text + tool_use, thinking + tool_use, etc.); this parser returns the
 * highest-signal event for that line, preferring `tool_use` > `thinking`
 * > `turn_summary` (text). Callers that want every content item must use a
 * streaming parser; one event per line is sufficient for metric aggregation.
 */
export function parseClaudeStreamLine(line: string): TraceEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  let parsed: ClaudeStreamEnvelope;
  try {
    parsed = JSON.parse(trimmed) as ClaudeStreamEnvelope;
  } catch {
    return null;
  }
  const eventType = pickString(parsed.type);
  if (!eventType) {
    return null;
  }

  if (eventType === "assistant") {
    return parseClaudeAssistantMessage(parsed.message);
  }

  if (eventType === "user") {
    return parseClaudeUserMessage(parsed.message);
  }

  if (eventType === "result") {
    return parseClaudeResult(parsed);
  }

  return null;
}

function parseClaudeAssistantMessage(message: unknown): TraceEvent | null {
  if (!isRecord(message)) {
    return null;
  }
  const typed = message as ClaudeAssistantMessage;
  const content = typed.content;
  if (!Array.isArray(content)) {
    return null;
  }

  // Prefer tool_use > thinking > turn_summary (text-only) so a single line
  // contributes the highest-signal event for metrics.
  let toolUse: ToolUseEvent | undefined;
  let thinking: ThinkingEvent | undefined;
  let sawText = false;

  for (const item of content) {
    if (!isRecord(item)) continue;
    const ci = item as ClaudeAssistantContent;
    const itemType = pickString(ci.type);
    if (itemType === "tool_use") {
      const name = pickString(ci.name);
      if (!name) continue;
      const input = isRecord(ci.input) ? (ci.input as Record<string, unknown>) : {};
      const toolUseId = pickString(ci.id);
      toolUse = {
        kind: "tool_use",
        name,
        input,
        ...(toolUseId !== undefined ? { toolUseId } : {}),
      };
    } else if (itemType === "thinking") {
      const text = pickString(ci.thinking);
      if (text) {
        thinking = { kind: "thinking", text };
      }
    } else if (itemType === "text") {
      sawText = true;
    }
  }

  if (toolUse) return toolUse;
  if (thinking) return thinking;
  if (sawText) {
    const usage = typed.usage;
    const inputTokens = pickNumber(usage?.input_tokens);
    const outputTokens = pickNumber(usage?.output_tokens);
    const cacheReadTokens = pickNumber(usage?.cache_read_input_tokens);
    return {
      kind: "turn_summary",
      turnIndex: 0, // caller may overwrite when ordering across the run
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    };
  }
  return null;
}

function parseClaudeUserMessage(message: unknown): TraceEvent | null {
  if (!isRecord(message)) return null;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (!isRecord(item)) continue;
    const ci = item as ClaudeUserContent;
    if (pickString(ci.type) !== "tool_result") continue;
    const toolUseId = pickString(ci.tool_use_id);
    const isError = ci.is_error === true;
    return {
      kind: "tool_result",
      ok: !isError,
      ...(toolUseId !== undefined ? { toolUseId } : {}),
    };
  }
  return null;
}

function parseClaudeResult(envelope: ClaudeStreamEnvelope): ResultEvent {
  const usage = envelope.usage;
  const durationMs = pickNumber(envelope.duration_ms);
  const numTurns = pickNumber(envelope.num_turns);
  const inputTokens = pickNumber(usage?.input_tokens);
  const outputTokens = pickNumber(usage?.output_tokens);
  const cacheReadTokens = pickNumber(usage?.cache_read_input_tokens);
  return {
    kind: "result",
    isError: envelope.is_error === true,
    text: pickString(envelope.result) ?? "",
    costUsd: pickNumber(envelope.total_cost_usd) ?? 0,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(numTurns !== undefined ? { numTurns } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
  };
}

type CodexStreamEnvelope = {
  type?: unknown;
  item?: unknown;
  message?: unknown;
  error?: unknown;
  usage?: {
    input_tokens?: unknown;
    cached_input_tokens?: unknown;
    output_tokens?: unknown;
  };
};

type CodexItem = {
  type?: unknown;
  text?: unknown;
  name?: unknown;
  input?: unknown;
  id?: unknown;
  command?: unknown;
  arguments?: unknown;
};

/**
 * Parse a single line of Codex's `exec --json` output.
 *
 * Codex emits a similar event stream, but with different field names:
 *   {"type":"item.completed","item":{"type":"agent_message"|"reasoning"|"command_execution"|...}}
 *   {"type":"turn.completed","usage":{"input_tokens":...,"cached_input_tokens":...,"output_tokens":...}}
 *   {"type":"turn.failed","error":{"message":...}}
 *
 * Codex does not surface raw tool_use events at the same granularity as Claude
 * — `command_execution` items are the closest analogue (the Bash equivalent).
 * Other tool calls (`file_change`, `web_search`, …) come through as their own
 * item types. We map them to `tool_use` events with the item type as `name`.
 */
export function parseCodexStreamLine(line: string): TraceEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  let parsed: CodexStreamEnvelope;
  try {
    parsed = JSON.parse(trimmed) as CodexStreamEnvelope;
  } catch {
    return null;
  }
  const eventType = pickString(parsed.type);
  if (!eventType) return null;

  if (eventType === "item.completed") {
    return parseCodexItem(parsed.item);
  }

  if (eventType === "turn.completed") {
    const usage = parsed.usage;
    const inputTokens = pickNumber(usage?.input_tokens);
    const outputTokens = pickNumber(usage?.output_tokens);
    const cacheReadTokens = pickNumber(usage?.cached_input_tokens);
    return {
      kind: "result",
      isError: false,
      text: "",
      costUsd: 0,
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    };
  }

  if (eventType === "turn.failed") {
    return {
      kind: "result",
      isError: true,
      text: pickString((parsed.error as { message?: unknown } | undefined)?.message) ?? "",
      costUsd: 0,
    };
  }

  return null;
}

function parseCodexItem(item: unknown): TraceEvent | null {
  if (!isRecord(item)) return null;
  const ci = item as CodexItem;
  const itemType = pickString(ci.type);
  if (!itemType) return null;

  if (itemType === "agent_message") {
    return { kind: "turn_summary", turnIndex: 0 };
  }

  if (itemType === "reasoning") {
    const text = pickString(ci.text);
    return text ? { kind: "thinking", text } : null;
  }

  if (itemType === "command_execution") {
    const command = pickString(ci.command);
    const toolUseId = pickString(ci.id);
    return {
      kind: "tool_use",
      name: "Bash",
      input: command ? { command } : {},
      ...(toolUseId !== undefined ? { toolUseId } : {}),
    };
  }

  // Generic fallback: surface any other item type as a tool_use with item.type
  // as the name. Captures file_change / web_search / mcp_tool_call etc.
  const name = itemType;
  const input = isRecord(ci.input) ? (ci.input as Record<string, unknown>) : {};
  const toolUseId = pickString(ci.id);
  return {
    kind: "tool_use",
    name,
    input,
    ...(toolUseId !== undefined ? { toolUseId } : {}),
  };
}

/**
 * Append one event to a JSONL trace file. Uses synchronous fs.appendFileSync
 * to preserve ordering when called from multiple stream listeners.
 */
export function appendTraceEvent(filePath: string, event: TraceEvent): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.appendFile(filePath, `${JSON.stringify(event)}\n`, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
