import fs from "node:fs";

/**
 * Discriminated union of behaviour-trace events surfaced from the codex CLI
 * output.
 *
 * The shape is intentionally minimal: only the fields the metrics aggregator
 * (and a future LLM-as-judge) actually inspect. Stream payloads carry far
 * more (`thread_id`, item ids, statuses, …) but we drop most of them here to
 * keep JSONL files small and easy to grep.
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
  /** Raw reasoning text emitted by the assistant. */
  text: string;
};

export type TurnSummaryEvent = {
  kind: "turn_summary";
  /** 0-based index counting turns seen so far. */
  turnIndex: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
};

export type ResultEvent = {
  kind: "result";
  /** Whether the run failed (non-zero exit, timeout, or codex error). */
  isError: boolean;
  /** Final assistant message text. */
  text: string;
  durationMs?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
};

type CodexEnvelope = {
  type?: unknown;
  item?: unknown;
  usage?: unknown;
  message?: unknown;
};

type CodexItem = {
  id?: unknown;
  type?: unknown;
  status?: unknown;
  text?: unknown;
  command?: unknown;
  path?: unknown;
  changes?: unknown;
  tool?: unknown;
  arguments?: unknown;
};

type CodexUsage = {
  input_tokens?: unknown;
  cached_input_tokens?: unknown;
  output_tokens?: unknown;
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
 * Parse a single line of codex's `exec --json` output.
 *
 * Event spec: https://developers.openai.com/codex/noninteractive
 *
 * Handled event types:
 *
 * - `turn.completed { usage }` → {@link TurnSummaryEvent}. `usage.input_tokens` /
 *   `usage.cached_input_tokens` / `usage.output_tokens` map to the canonical
 *   `inputTokens` / `cacheReadTokens` / `outputTokens` fields the adapter
 *   accumulates.
 * - `turn.failed` and `error { message }` → {@link ResultEvent} with `isError: true`.
 * - `item.completed { item }` based on `item.type`:
 *   - `command_execution` → `tool_use` named `"Bash"` (input `{ command }`).
 *   - `file_change` → `tool_use` named `"Edit"` (input `{ file_path, changes? }`).
 *   - `mcp_tool_call` → `tool_use` named after the MCP tool with its
 *     `arguments` as input.
 *   - `web_search` → `tool_use` named `"WebSearch"` (input `{ query }` when
 *     present).
 *   - `reasoning` → `thinking`.
 *   - `agent_message` and `plan_update` return `null` — the final assistant
 *     message is captured by the adapter for `ResultEvent.text`, and plan
 *     updates carry no aggregatable signal.
 * - `item.started` / `item.updated` are intentionally dropped to avoid
 *   double-counting in {@link aggregateTraceMetrics}.
 *
 * Tool names are mapped to Pascal-case (`Bash`, `Edit`, `WebSearch`, …) so
 * the downstream `metrics.ts BASH_RETRY_COMMANDS` matcher (which compares
 * against the literal `"Bash"`) and per-tool counts stay stable across
 * agent rewrites.
 */
export function parseCodexStreamLine(line: string): TraceEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: CodexEnvelope;
  try {
    parsed = JSON.parse(trimmed) as CodexEnvelope;
  } catch {
    return null;
  }
  const eventType = pickString(parsed.type);
  if (!eventType) return null;

  if (eventType === "turn.completed") {
    return parseCodexTurnCompleted(parsed.usage);
  }
  if (eventType === "turn.failed") {
    return { kind: "result", isError: true, text: "turn.failed" };
  }
  if (eventType === "error") {
    const message = pickString(parsed.message) ?? "codex error";
    return { kind: "result", isError: true, text: message };
  }
  if (eventType === "item.completed") {
    return parseCodexItemCompleted(parsed.item);
  }
  return null;
}

function parseCodexTurnCompleted(usage: unknown): TraceEvent | null {
  if (!isRecord(usage)) return null;
  const u = usage as CodexUsage;
  const inputTokens = pickNumber(u.input_tokens);
  const outputTokens = pickNumber(u.output_tokens);
  const cacheReadTokens = pickNumber(u.cached_input_tokens);
  return {
    kind: "turn_summary",
    // turnIndex is per-line; the adapter does not currently re-number across
    // the run. `aggregateTraceMetrics` ignores turnIndex so leaving 0 is safe.
    turnIndex: 0,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
  };
}

function parseCodexItemCompleted(rawItem: unknown): TraceEvent | null {
  if (!isRecord(rawItem)) return null;
  const item = rawItem as CodexItem;
  const itemType = pickString(item.type);
  if (!itemType) return null;
  const id = pickString(item.id);

  switch (itemType) {
    case "reasoning": {
      const text = pickString(item.text);
      if (!text) return null;
      return { kind: "thinking", text };
    }
    case "command_execution": {
      const command = pickString(item.command);
      if (!command) return null;
      return {
        kind: "tool_use",
        name: "Bash",
        input: { command },
        ...(id ? { toolUseId: id } : {}),
      };
    }
    case "file_change": {
      const filePath = pickString(item.path);
      if (!filePath) return null;
      const changes = pickString(item.changes);
      return {
        kind: "tool_use",
        name: "Edit",
        input: { file_path: filePath, ...(changes !== undefined ? { changes } : {}) },
        ...(id ? { toolUseId: id } : {}),
      };
    }
    case "mcp_tool_call": {
      const tool = pickString(item.tool);
      if (!tool) return null;
      const argv = isRecord(item.arguments) ? (item.arguments as Record<string, unknown>) : {};
      return {
        kind: "tool_use",
        name: tool,
        input: argv,
        ...(id ? { toolUseId: id } : {}),
      };
    }
    case "web_search": {
      const text = pickString(item.text);
      return {
        kind: "tool_use",
        name: "WebSearch",
        input: text !== undefined ? { query: text } : {},
        ...(id ? { toolUseId: id } : {}),
      };
    }
    // agent_message and plan_update: caller handles agent_message separately
    // for ResultEvent.text; plan_update is intentionally dropped.
    default:
      return null;
  }
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
