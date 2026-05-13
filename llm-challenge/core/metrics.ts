import fs from "node:fs";
import type { TraceEvent } from "./trace";

/**
 * Classification of a `Read` tool_use file path into one of five buckets.
 *
 * Used as the primary signal for "what kind of context did the agent need to
 * consult" — finer-grained than the legacy boolean buckets `readSdkDts` /
 * `readDocs` so iteration-variance analyses can tell apart, for example,
 * "needed the SDK source to debug a runtime bug" vs "needed the SDK docs".
 *
 * Bucket semantics (first match wins, in this precedence order):
 *
 * - `sdk-dts`: TypeScript declaration files inside the SDK package
 *   (`node_modules/@tailor-platform/sdk/**\/*.d.{ts,mts,cts}`). Captures the
 *   agent reaching into the published type surface.
 * - `sdk-package-src`: Non-declaration source files inside the SDK package
 *   (`.ts` / `.mts` / `.cts` / `.js` / `.mjs` / `.cjs` under
 *   `node_modules/@tailor-platform/sdk/**`). Catches the agent stepping
 *   through SDK *implementation* — usually a stronger signal than dts.
 * - `sdk-docs`: Markdown files inside the SDK package, OR any path matching
 *   `docs/**` at any level, OR a `README*` file at any level. Captures
 *   prose-explanation reads.
 * - `problem-files`: Project-tree files (NOT under `node_modules`) that
 *   match `tests/`, `tailor.config.ts`, `scaffold/`, or `problem.md`.
 *   These are the agent's own working files.
 * - `other`: Anything else (lockfiles, package.json, tsconfig, etc.).
 */
export const READ_TARGET_CLASSES = [
  "sdk-dts",
  "sdk-package-src",
  "sdk-docs",
  "problem-files",
  "other",
] as const;
export type ReadTargetClass = (typeof READ_TARGET_CLASSES)[number];

const SDK_PACKAGE_PREFIX = "node_modules/@tailor-platform/sdk";

/**
 * Classify a Read tool_use `file_path` into one of the five
 * {@link ReadTargetClass} buckets. Uses simple substring / suffix matching
 * (no regex backtracking) and follows the precedence documented on
 * {@link ReadTargetClass} — the first matching bucket wins.
 *
 * Paths can be absolute or relative; we only inspect substrings, so paths
 * like `/workspace/node_modules/@tailor-platform/sdk/dist/index.d.ts`
 * classify the same as `node_modules/@tailor-platform/sdk/dist/index.d.ts`.
 */
export function classifyReadTarget(filePath: string): ReadTargetClass {
  // Normalize Windows backslashes so the substring/suffix checks below are
  // platform-independent. Read events from Claude / Codex are usually POSIX,
  // but the classifier should still work if someone runs on Windows.
  const normalized = filePath.replace(/\\/g, "/");
  const inSdkPackage = normalized.includes(SDK_PACKAGE_PREFIX);

  if (inSdkPackage) {
    if (
      normalized.endsWith(".d.ts") ||
      normalized.endsWith(".d.mts") ||
      normalized.endsWith(".d.cts")
    ) {
      return "sdk-dts";
    }
    if (
      normalized.endsWith(".ts") ||
      normalized.endsWith(".mts") ||
      normalized.endsWith(".cts") ||
      normalized.endsWith(".js") ||
      normalized.endsWith(".mjs") ||
      normalized.endsWith(".cjs")
    ) {
      return "sdk-package-src";
    }
    if (normalized.endsWith(".md")) {
      return "sdk-docs";
    }
    // SDK package files we do not recognise (e.g. JSON, .map) fall through
    // to the generic doc/problem/other classifier below.
  }

  // docs/** at any depth, README at any depth — these apply regardless of
  // whether the path is inside node_modules (e.g. an external repo's README
  // pulled into the work dir would still classify as docs).
  if (/(^|\/)docs\//.test(normalized) || /(^|\/)README([._-]|$)/i.test(normalized)) {
    return "sdk-docs";
  }

  // Problem-tree files. By construction these never live inside node_modules
  // — the runner's work dir layout puts `tests/` / `tailor.config.ts` /
  // `scaffold/` / `problem.md` at the work-dir root or directly inside
  // problem dirs.
  if (!normalized.includes("node_modules/")) {
    if (
      /(^|\/)tests\//.test(normalized) ||
      /(^|\/)tailor\.config\.ts$/.test(normalized) ||
      /(^|\/)scaffold\//.test(normalized) ||
      /(^|\/)problem\.md$/.test(normalized)
    ) {
      return "problem-files";
    }
  }

  return "other";
}

/**
 * Behavioural metrics computed from a single solve attempt's trace.jsonl.
 *
 * Designed for diff-able comparisons across runs and as input to the
 * iteration-variance / profile-diff analyses. Field semantics:
 *
 * - `turns`: count of `tool_use` events. Approximates agent activity; for
 *   Claude this is roughly num_turns × tools-per-turn, for Codex it counts
 *   command_execution + file_change + ... items.
 * - `toolCallCounts`: per-tool frequency. Keys are the tool name reported by
 *   the adapter (e.g. "Read", "Bash"); a `_other` bucket aggregates names
 *   we have not seen before.
 * - `readTargets`: per-class counts of `Read` calls, classified via
 *   {@link classifyReadTarget}. Replaces the coarse legacy buckets — the
 *   `sdk-dts` / `sdk-docs` slices are still surfaced as derived legacy
 *   fields for back-compat.
 * - `readSdkDts`: derived; equals `readTargets["sdk-dts"]`. Kept on the wire
 *   so older analysers and report renderers still work.
 * - `readDocs`: derived; equals `readTargets["sdk-docs"]`. Same back-compat
 *   rationale.
 * - `bashRetries`: how many `Bash` calls re-ran `tsc` / `vitest` /
 *   `tailor-sdk generate` / `pnpm test`. Proxy for compile/test loops.
 * - `totalDurationMs`: sum of per-event durations when the adapter surfaces
 *   them (not currently populated by the Claude or Codex parsers; reserved
 *   for future extension).
 */
export type TraceMetrics = {
  turns: number;
  toolCallCounts: Record<string, number>;
  readTargets: Record<ReadTargetClass, number>;
  readSdkDts: number;
  readDocs: number;
  bashRetries: number;
  totalDurationMs?: number;
};

const BASH_RETRY_COMMANDS = [
  /\btsc\b/,
  /\bvitest\b/,
  /\btailor-sdk\s+generate\b/,
  /\bpnpm\s+test\b/,
  /\bpnpm\s+typecheck\b/,
];

function emptyReadTargets(): Record<ReadTargetClass, number> {
  return {
    "sdk-dts": 0,
    "sdk-package-src": 0,
    "sdk-docs": 0,
    "problem-files": 0,
    other: 0,
  };
}

function emptyMetrics(): TraceMetrics {
  return {
    turns: 0,
    toolCallCounts: {},
    readTargets: emptyReadTargets(),
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
        const bucket = classifyReadTarget(filePath);
        metrics.readTargets[bucket] += 1;
      }
    }

    if (event.name === "Bash") {
      const command = pickString(event.input["command"]) ?? "";
      if (BASH_RETRY_COMMANDS.some((p) => p.test(command))) {
        metrics.bashRetries += 1;
      }
    }
  }
  // Derive legacy buckets from the new fine-grained map so back-compat
  // readers (older report renderers, analyse tool) keep working.
  metrics.readSdkDts = metrics.readTargets["sdk-dts"];
  metrics.readDocs = metrics.readTargets["sdk-docs"];
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
