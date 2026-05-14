import fs from "node:fs";

/**
 * Discriminated union of behaviour-trace events surfaced from the opencode CLI
 * output.
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
  /** Whether the run failed (non-zero exit, timeout, or opencode error). */
  isError: boolean;
  /** Final assistant message text. */
  text: string;
  durationMs?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
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
 * Map an opencode tool name (lowercase, e.g. "read", "bash") onto its Claude
 * equivalent (e.g. "Read", "Bash"). The mapping is load-bearing for
 * `metrics.ts`, which keys `bashRetries` off the name `"Bash"` and uses
 * `event.input["file_path"]` for `classifyReadTarget` — both of which would
 * silently zero out if the opencode names leaked through. Unknown names pass
 * through verbatim so future tools register as themselves in
 * `toolCallCounts._other`.
 *
 * Naming note: opencode 1.14.50 emits the shell tool as `bash` in the wire
 * stream (verified against the m01 E2E run on 2026-05-15). Earlier docs and
 * source paths referred to it as `shell`; we keep that alias so older opencode
 * releases stay parseable.
 */
const OPENCODE_TOOL_NAME_MAP: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  bash: "Bash",
  shell: "Bash",
  glob: "Glob",
  grep: "Grep",
};

/**
 * Translate opencode's camelCase argument keys (`filePath`, `oldString`, …)
 * to the snake_case keys that `metrics.ts` reads (`file_path`, `old_string`).
 * Only the keys we know are remapped; unknown keys forward unchanged so the
 * full payload survives for trace inspection.
 */
const OPENCODE_INPUT_KEY_MAP: Record<string, string> = {
  filePath: "file_path",
  oldString: "old_string",
  newString: "new_string",
  replaceAll: "replace_all",
};

function normaliseOpencodeInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[OPENCODE_INPUT_KEY_MAP[key] ?? key] = value;
  }
  return out;
}

type OpencodeStreamEnvelope = {
  type?: unknown;
  part?: unknown;
};

type OpencodeToolPart = {
  type?: unknown;
  tool?: unknown;
  callID?: unknown;
  state?: unknown;
};

type OpencodeToolState = {
  status?: unknown;
  input?: unknown;
};

type OpencodeStepFinishPart = {
  tokens?: {
    input?: unknown;
    output?: unknown;
    reasoning?: unknown;
    cache?: {
      read?: unknown;
      write?: unknown;
    };
  };
};

type OpencodeReasoningPart = {
  type?: unknown;
  text?: unknown;
};

type OpencodeErrorPart = {
  message?: unknown;
  error?: unknown;
};

/**
 * Parse a single line of opencode's `run --format json` output.
 *
 * Stream-line shapes (verified against opencode 1.14.50 + gpt-oss:20b on
 * 2026-05-15 — see `.agent/tmp/llm-challenge-oss-plan.md` "Phase 2 smoke-test
 * verified facts" for full payloads):
 *
 *   {"type":"tool_use","part":{"type":"tool","tool":"write","callID":"...",
 *      "state":{"status":"completed","input":{"filePath":"...","content":"..."}, ...}}}
 *   {"type":"step_finish","part":{"reason":"tool-calls",
 *      "tokens":{"input":...,"output":...,"reasoning":...,"cache":{"read":...,"write":...}},
 *      "cost":0}}
 *   {"type":"text","part":{"type":"text","text":"..."}}
 *   {"type":"reasoning","part":{"type":"reasoning","text":"..."}}  // not seen in smoke but documented
 *   {"type":"error","part":{...}}                                  // documented
 *
 * Two normalisation steps make the output drop-in compatible with the metric
 * aggregator:
 *
 * 1. `part.tool` (lowercase: `read|write|edit|shell|glob|grep`) is mapped to
 *    Claude's name convention via {@link OPENCODE_TOOL_NAME_MAP}. The
 *    `shell → Bash` rename is load-bearing because `metrics.ts BASH_RETRY_COMMANDS`
 *    matches on the name `"Bash"`.
 * 2. `part.state.input` keys (camelCase: `filePath`, `oldString`, …) are
 *    snake_cased via {@link OPENCODE_INPUT_KEY_MAP}, so `metrics.classifyReadTarget`
 *    can still read `event.input["file_path"]`.
 *
 * Only the `state.status === "completed"` line of a multi-state tool stream
 * produces an event — earlier `partial-call` / `call` states are dropped to
 * avoid duplicate counts in `toolCallCounts`. `step_finish` lines are surfaced
 * as `turn_summary` events with the per-step token usage; the OSS adapter
 * accumulates them and synthesises the final `ResultEvent` itself, since
 * opencode emits no Claude-style `{"type":"result", ...}` envelope.
 */
export function parseOpencodeStreamLine(line: string): TraceEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  let parsed: OpencodeStreamEnvelope;
  try {
    parsed = JSON.parse(trimmed) as OpencodeStreamEnvelope;
  } catch {
    return null;
  }
  const eventType = pickString(parsed.type);
  if (!eventType) return null;

  if (eventType === "tool_use") {
    return parseOpencodeToolUse(parsed.part);
  }

  if (eventType === "step_finish") {
    return parseOpencodeStepFinish(parsed.part);
  }

  if (eventType === "reasoning" || eventType === "thinking") {
    return parseOpencodeReasoning(parsed.part);
  }

  if (eventType === "error") {
    return parseOpencodeError(parsed.part);
  }

  // text / step_start / message.* / session.* are intentionally ignored.
  // The adapter captures the last `text` event separately for ResultEvent.text.
  return null;
}

function parseOpencodeToolUse(part: unknown): TraceEvent | null {
  if (!isRecord(part)) return null;
  const tp = part as OpencodeToolPart;
  if (pickString(tp.type) !== "tool") return null;
  const rawName = pickString(tp.tool);
  if (!rawName) return null;
  const state = isRecord(tp.state) ? (tp.state as OpencodeToolState) : undefined;
  if (!state) return null;
  // Only emit on the terminal `completed` state — intermediate partial-call /
  // call lines stream as the model builds the argument JSON and would otherwise
  // double-count in metrics.toolCallCounts.
  if (pickString(state.status) !== "completed") return null;
  const rawInput = isRecord(state.input) ? (state.input as Record<string, unknown>) : {};
  const name = OPENCODE_TOOL_NAME_MAP[rawName] ?? rawName;
  const input = normaliseOpencodeInput(rawInput);
  const toolUseId = pickString(tp.callID);
  return {
    kind: "tool_use",
    name,
    input,
    ...(toolUseId !== undefined ? { toolUseId } : {}),
  };
}

function parseOpencodeStepFinish(part: unknown): TraceEvent | null {
  if (!isRecord(part)) return null;
  const sp = part as OpencodeStepFinishPart;
  const tokens = sp.tokens;
  if (!tokens) return null;
  const inputTokens = pickNumber(tokens.input);
  const outputTokens = pickNumber(tokens.output);
  const cacheReadTokens = pickNumber(tokens.cache?.read);
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

function parseOpencodeReasoning(part: unknown): TraceEvent | null {
  if (!isRecord(part)) return null;
  const rp = part as OpencodeReasoningPart;
  const text = pickString(rp.text);
  if (!text) return null;
  return { kind: "thinking", text };
}

function parseOpencodeError(part: unknown): TraceEvent | null {
  if (!isRecord(part)) return null;
  const ep = part as OpencodeErrorPart;
  // Try common shapes: `part.message` (string), `part.error.message`, then fall
  // back to JSON-stringifying the whole part so we never silently drop a
  // failure envelope.
  const message =
    pickString(ep.message) ??
    (isRecord(ep.error) ? pickString((ep.error as { message?: unknown }).message) : undefined) ??
    JSON.stringify(part);
  return {
    kind: "result",
    isError: true,
    text: message,
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
