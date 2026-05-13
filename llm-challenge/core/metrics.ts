import fs from "node:fs";
import type { TraceEvent } from "./trace";

/**
 * Behavioural metrics computed from a single solve attempt's trace.jsonl.
 *
 * Designed for diff-able comparisons across runs and as input to the
 * LLM-as-judge prompt. Field semantics:
 *
 * - `turns`: count of `tool_use` events. Approximates agent activity; for
 *   Claude this is roughly num_turns × tools-per-turn, for Codex it counts
 *   command_execution + file_change + ... items.
 * - `toolCallCounts`: per-tool frequency. Keys are the tool name reported by
 *   the adapter (e.g. "Read", "Bash"); a `_other` bucket aggregates names
 *   we have not seen before.
 * - `readSdkDts`: how many `Read` calls hit `node_modules/@tailor-platform/sdk`
 *   `.d.ts` files. Proxy for "agent needed to consult SDK type definitions".
 * - `readDocs`: how many `Read` calls hit `docs/` or `README*`. Proxy for
 *   "agent needed external prose explanations".
 * - `bashRetries`: how many `Bash` calls re-ran `tsc` / `vitest` /
 *   `tailor-sdk generate` / `pnpm test`. Proxy for compile/test loops.
 * - `totalDurationMs`: sum of per-event durations when the adapter surfaces
 *   them (not currently populated by the Claude or Codex parsers; reserved
 *   for future extension).
 */
export type TraceMetrics = {
  turns: number;
  toolCallCounts: Record<string, number>;
  readSdkDts: number;
  readDocs: number;
  bashRetries: number;
  totalDurationMs?: number;
};

const SDK_DTS_PATTERN = /node_modules\/@tailor-platform\/sdk[^\s]*\.d\.ts\b/;
const DOCS_PATTERN = /(^|\/)docs\/|(^|\/)README([._-]|$)/i;
const BASH_RETRY_COMMANDS = [
  /\btsc\b/,
  /\bvitest\b/,
  /\btailor-sdk\s+generate\b/,
  /\bpnpm\s+test\b/,
  /\bpnpm\s+typecheck\b/,
];

function emptyMetrics(): TraceMetrics {
  return {
    turns: 0,
    toolCallCounts: {},
    readSdkDts: 0,
    readDocs: 0,
    bashRetries: 0,
  };
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Stateless aggregator: walk a sequence of trace events and produce the
 * metrics vector. Exported separately from `computeTraceMetrics` for tests
 * that want to assert against synthetic event arrays without a file.
 */
export function aggregateTraceMetrics(events: Iterable<TraceEvent>): TraceMetrics {
  const metrics = emptyMetrics();
  for (const event of events) {
    if (event.kind !== "tool_use") continue;
    metrics.turns += 1;
    metrics.toolCallCounts[event.name] = (metrics.toolCallCounts[event.name] ?? 0) + 1;

    if (event.name === "Read") {
      const filePath = pickString(event.input["file_path"]);
      if (filePath) {
        if (SDK_DTS_PATTERN.test(filePath)) {
          metrics.readSdkDts += 1;
        }
        if (DOCS_PATTERN.test(filePath)) {
          metrics.readDocs += 1;
        }
      }
    }

    if (event.name === "Bash") {
      const command = pickString(event.input["command"]) ?? "";
      if (BASH_RETRY_COMMANDS.some((p) => p.test(command))) {
        metrics.bashRetries += 1;
      }
    }
  }
  return metrics;
}

/**
 * Read a JSONL trace file and compute aggregate metrics. Silently tolerates
 * missing/empty/truncated files (returns the empty-metrics shell) so callers
 * never need to gate on file existence.
 */
export function computeTraceMetrics(traceFile: string): TraceMetrics {
  let content: string;
  try {
    content = fs.readFileSync(traceFile, "utf-8");
  } catch {
    return emptyMetrics();
  }
  const events: TraceEvent[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as TraceEvent;
      events.push(parsed);
    } catch {
      // skip malformed line
    }
  }
  return aggregateTraceMetrics(events);
}

export type MetricsAggregate = {
  count: number;
  min: number;
  max: number;
  median: number;
  mean: number;
};

export type MetricsSummary = {
  turns: MetricsAggregate;
  readSdkDts: MetricsAggregate;
  readDocs: MetricsAggregate;
  bashRetries: MetricsAggregate;
  /** Per-tool call counts aggregated as min/max/median across runs. */
  toolCalls: Record<string, MetricsAggregate>;
};

function aggregate(values: number[]): MetricsAggregate {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, median: 0, mean: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  return {
    count: sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    median,
    mean,
  };
}

/**
 * Aggregate per-result metrics into a summary suitable for the run-level
 * report.analytics block.
 */
export function summarizeMetrics(metricsList: TraceMetrics[]): MetricsSummary | undefined {
  if (metricsList.length === 0) return undefined;
  const toolNames = new Set<string>();
  for (const m of metricsList) {
    for (const name of Object.keys(m.toolCallCounts)) toolNames.add(name);
  }
  const toolCalls: Record<string, MetricsAggregate> = {};
  for (const name of toolNames) {
    toolCalls[name] = aggregate(metricsList.map((m) => m.toolCallCounts[name] ?? 0));
  }
  return {
    turns: aggregate(metricsList.map((m) => m.turns)),
    readSdkDts: aggregate(metricsList.map((m) => m.readSdkDts)),
    readDocs: aggregate(metricsList.map((m) => m.readDocs)),
    bashRetries: aggregate(metricsList.map((m) => m.bashRetries)),
    toolCalls,
  };
}
