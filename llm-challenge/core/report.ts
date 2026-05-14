import { problemKey } from "../shared/helpers";
import {
  type MetricsSummary,
  READ_TARGET_CLASSES,
  type ReadTargetClass,
  type TraceMetrics,
  summarizeMetrics,
} from "./metrics";
import type { SolveResult } from "./solver/types";
import type { ChallengeStage, StageInput, TestDetail } from "./verify";

export type StageResult = {
  stage: ChallengeStage;
  passed: boolean;
  output: string;
  durationMs?: number;
  testsPassed?: number;
  testsTotal?: number;
  testDetails?: TestDetail[];
};

export type ScaffoldChange = {
  file: string;
  original: string;
  modified: string;
};

export type ProblemArtifacts = {
  directory: string;
};

/**
 * Aggregate statistics across N iterations of the same (problem, agent, model,
 * profile) task. Populated only when `iterations.count > 1` (i.e. multi-run
 * mode); single-iteration runs leave this undefined.
 *
 * `passRate` is the fraction of iterations that passed (passedCount / count).
 * `metricsMedian` / `metricsStdev` summarise the legacy behavioural counters
 * (`turns`, `readSdkDts`, `readDocs`, `bashRetries`) AND the five per-class
 * `readTargets` buckets ({@link ReadTargetClass}). The new bucket-level
 * fields are populated alongside the legacy fields for back-compat.
 * `costMedian` / `costStdev` summarise per-iteration `solveResult.costUsd`.
 */
export type IterationAggregate = {
  count: number;
  passedCount: number;
  passRate: number;
  passedByIteration: boolean[];
  costMedian: number;
  costStdev: number;
  metricsMedian: {
    turns: number;
    readSdkDts: number;
    readDocs: number;
    bashRetries: number;
  } & Record<ReadTargetClass, number>;
  metricsStdev: {
    turns: number;
    readSdkDts: number;
    readDocs: number;
    bashRetries: number;
  } & Record<ReadTargetClass, number>;
};

export type ProblemResult = {
  problemId: string;
  problemName: string;
  difficulty: string;
  category: string;
  /**
   * Split label inherited from meta.json. Kept on the wire for forward
   * compatibility with the future micro-problem split rollout (Phase 2+),
   * but currently unused by analytics.
   */
  split?: string;
  contextProfile?: string;
  stages: StageResult[];
  /**
   * Aggregate pass/fail for the problem: true iff every stage passed.
   */
  passed: boolean;
  solveResult?: SolveResult;
  totalDurationMs?: number;
  scaffoldChanges?: ScaffoldChange[];
  artifacts?: ProblemArtifacts;
  /**
   * Behavioural metrics aggregated from the per-attempt trace.jsonl. Optional
   * because `--use-solution` and pre-Phase-3 reports do not emit traces.
   */
  metrics?: TraceMetrics;
  /**
   * Multi-iteration aggregate (Phase 4). Present only when the same task was
   * run with `--iterations N` (N > 1) so the variance bounds are available
   * for A/B comparisons. Single-iteration runs leave this undefined.
   */
  iterations?: IterationAggregate;
};

export type SuccessRate = { passed: number; total: number; rate: number };

/**
 * Reason for a problem failing every iteration. Surfaces the kind of "stable
 * fail" so operators can act on it: `stable_fail` means the solver completed
 * but every iteration failed verification (SDK improvement candidate);
 * `infra_failure` means the solve infrastructure (auth / Podman / etc.)
 * prevented the run from producing a meaningful signal.
 */
export type PersistentFailureReason = "stable_fail" | "infra_failure";

export type PersistentFailure = {
  problemId: string;
  reason: PersistentFailureReason;
};

type Analytics = {
  stagePassRates: Record<string, SuccessRate>;
  /**
   * Aggregate behavioural-metrics summary across every result that carries a
   * `metrics` field. Undefined when no result emitted a trace (e.g. all
   * `--use-solution` runs).
   */
  metricsSummary?: MetricsSummary;
  /**
   * Problems that failed every iteration. `stable_fail` entries are SDK
   * improvement candidates — the agent finished but could not solve them;
   * `infra_failure` entries are excluded from rendering but kept in the
   * structured payload for downstream tooling. Optional for forward / backward
   * compatibility with reports persisted before this field existed.
   */
  persistentFailures?: PersistentFailure[];
};

/**
 * Aggregate token usage across every solve attempt in the run. All fields are
 * optional: usage is best-effort and may be missing for adapters or older
 * reports that did not record it.
 */
export type UsageSummary = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  numTurns?: number;
};

export type ChallengeReport = {
  timestamp: string;
  model?: string;
  contextProfile?: string;
  sdkVersion?: string;
  /**
   * Git ref of the SDK packed for this run, when explicitly set via
   * `--sdk-branch`. Undefined for runs that used the current working tree
   * (the default). Captured for A/B experiment provenance.
   */
  sdkBranch?: string;
  /**
   * Number of solve iterations per (problem, agent, model, profile). 1 for
   * single-run mode (the default for verify/use-solution). Captured for A/B
   * comparisons so the analyze tool can warn on mismatched iteration counts.
   */
  iterationCount?: number;
  results: ProblemResult[];
  problemsPassed: number;
  problemsTotal: number;
  percentage: number;
  totalCostUsd: number;
  costPerPass?: number;
  infraFailureCount: number;
  validPercentage: number;
  totalDurationMs: number;
  analytics: Analytics;
  /** Run-level token usage summary. Undefined when no adapter reported usage. */
  usageSummary?: UsageSummary;
};

/**
 * Compute success rates grouped by a key function.
 * Each item is counted once; items where predicate returns true are counted as passed.
 */
export function computeSuccessRates<T>(
  items: T[],
  keyFn: (item: T) => string,
  passedFn: (item: T) => boolean,
): Record<string, SuccessRate> {
  const groups: Record<string, { passed: number; total: number }> = {};
  for (const item of items) {
    const group = (groups[keyFn(item)] ??= { passed: 0, total: 0 });
    group.total++;
    if (passedFn(item)) {
      group.passed++;
    }
  }
  const rates: Record<string, SuccessRate> = {};
  for (const [key, g] of Object.entries(groups)) {
    rates[key] = { ...g, rate: g.total > 0 ? Math.round((g.passed / g.total) * 100) : 0 };
  }
  return rates;
}

function isStageSkipped(stage: StageResult): boolean {
  return stage.output?.startsWith("Skipped") ?? false;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Population standard deviation (not sample stdev). With N=3 iterations the
 * sample-vs-population distinction is small but population stdev is more
 * defensible as a "spread within this fixed run" metric, which matches the
 * A/B experiment use case (we are not extrapolating to a wider population).
 */
function stdev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Reduce N per-iteration `ProblemResult`s (same problem run N times) into a
 * single aggregate result. Caller is responsible for ensuring the inputs all
 * refer to the same `problemId`. The first iteration's metadata (stages,
 * difficulty, etc.) is preserved for table rendering; the multi-iteration
 * payload lives under the new `iterations` field.
 */
export const ITERATION_METRIC_KEYS = ["turns", "readSdkDts", "readDocs", "bashRetries"] as const;
export type IterationMetricKey = (typeof ITERATION_METRIC_KEYS)[number];

export function aggregateIterations(perIteration: ProblemResult[]): ProblemResult {
  if (perIteration.length === 0) {
    throw new Error("aggregateIterations: empty input");
  }
  if (perIteration.length === 1) {
    return perIteration[0]!;
  }
  const first = perIteration[0]!;
  const passedByIteration = perIteration.map((r) => r.passed);
  const passedCount = passedByIteration.filter(Boolean).length;
  const costs = perIteration.map((r) => r.solveResult?.costUsd ?? 0);

  // Drop iterations with no trace from the median/stdev sample so we don't
  // bias toward zero when --use-solution + --solve are mixed in one run.
  const metricsValues: Record<IterationMetricKey, number[]> = {
    turns: [],
    readSdkDts: [],
    readDocs: [],
    bashRetries: [],
  };
  const readTargetValues: Record<ReadTargetClass, number[]> = {
    "sdk-dts": [],
    "sdk-package-src": [],
    "sdk-docs": [],
    "problem-files": [],
    other: [],
  };
  for (const r of perIteration) {
    if (!r.metrics) continue;
    for (const k of ITERATION_METRIC_KEYS) {
      metricsValues[k].push(r.metrics[k]);
    }
    for (const cls of READ_TARGET_CLASSES) {
      // Tolerate trace files written before readTargets was added — fall
      // back to 0 so older fixtures and pre-Phase-5b reports still merge.
      readTargetValues[cls].push(r.metrics.readTargets?.[cls] ?? 0);
    }
  }
  const mapMetrics = <T>(
    fn: (values: number[]) => T,
  ): Record<IterationMetricKey, T> & Record<ReadTargetClass, T> => ({
    turns: fn(metricsValues.turns),
    readSdkDts: fn(metricsValues.readSdkDts),
    readDocs: fn(metricsValues.readDocs),
    bashRetries: fn(metricsValues.bashRetries),
    "sdk-dts": fn(readTargetValues["sdk-dts"]),
    "sdk-package-src": fn(readTargetValues["sdk-package-src"]),
    "sdk-docs": fn(readTargetValues["sdk-docs"]),
    "problem-files": fn(readTargetValues["problem-files"]),
    other: fn(readTargetValues.other),
  });

  const iterations: IterationAggregate = {
    count: perIteration.length,
    passedCount,
    passRate: passedCount / perIteration.length,
    passedByIteration,
    costMedian: median(costs),
    costStdev: stdev(costs),
    metricsMedian: mapMetrics(median),
    metricsStdev: mapMetrics(stdev),
  };

  // The "best" iteration drives the binary `passed` field so existing
  // pass-rate reporting stays meaningful. Prefer a passing iteration; fall
  // back to the first one if none passed.
  const best = perIteration.find((r) => r.passed) ?? first;

  return {
    ...best,
    iterations,
    // passed is true iff ANY iteration passed — matches typical "at least once" semantics.
    passed: passedCount > 0,
  };
}

/**
 * Convert raw verify stages into final StageResult records.
 * Binary pass/fail per stage — no partial credit, no failure categories.
 */
export function finalizeStages(stages: StageInput[]): StageResult[] {
  return stages.map((s) => ({ ...s }));
}

/**
 * A problem is treated as an infra failure when every stage was skipped via
 * the dedicated "infrastructure failure" reason (set by cli.ts when the solve
 * adapter reports `infraFailure`).
 */
export function isInfraFailure(result: ProblemResult): boolean {
  return (
    result.stages.length > 0 &&
    result.stages.every((s) => s.output.startsWith("Skipped (infrastructure failure)"))
  );
}

export function isPassed(result: ProblemResult): boolean {
  return result.passed;
}

/**
 * Compute analytics across the results in scope.
 *
 * - `validResults` is the infra-failure-stripped view used for behavioural
 *   metrics and stage pass rates (infra failures carry no signal there).
 * - `allResults` is the full set used to tag persistent failures so the
 *   `infra_failure` bucket can be separated from `stable_fail`.
 *   Defaults to `validResults` for backward compatibility with callers that
 *   only have a single view.
 */
function computeAnalytics(validResults: ProblemResult[], allResults?: ProblemResult[]): Analytics {
  const persistentSource = allResults ?? validResults;
  // Stage pass rates (exclude skipped stages from totals)
  const stageItems: { stage: string; passed: boolean }[] = [];
  for (const r of validResults) {
    for (const s of r.stages) {
      if (!isStageSkipped(s)) {
        stageItems.push({ stage: s.stage, passed: s.passed });
      }
    }
  }
  const stagePassRates = computeSuccessRates(
    stageItems,
    (s) => s.stage,
    (s) => s.passed,
  );

  const metricsList = validResults
    .map((r) => r.metrics)
    .filter((m): m is TraceMetrics => m !== undefined);
  const metricsSummary = summarizeMetrics(metricsList);

  return {
    stagePassRates,
    ...(metricsSummary ? { metricsSummary } : {}),
    persistentFailures: computePersistentFailures(persistentSource),
  };
}

/**
 * Pick out problems that never passed in this run. Multi-iteration runs use
 * `iterations.passRate === 0`; single-iteration runs fall back to `!passed`.
 * Each failing problem is tagged `infra_failure` when every stage is the
 * infra-failure sentinel — that bucket is surfaced separately because it
 * carries no SDK-affordance signal.
 */
function computePersistentFailures(results: ProblemResult[]): PersistentFailure[] {
  const out: PersistentFailure[] = [];
  for (const r of results) {
    const passRate = r.iterations?.passRate ?? (r.passed ? 1 : 0);
    if (passRate > 0) continue;
    out.push({
      problemId: r.problemId,
      reason: isInfraFailure(r) ? "infra_failure" : "stable_fail",
    });
  }
  return out;
}

function computeProblemCost(result: ProblemResult): number {
  return result.solveResult?.costUsd ?? 0;
}

function addUsage(acc: UsageSummary, usage: SolveResult["usage"]): void {
  if (!usage) return;
  if (usage.inputTokens !== undefined) {
    acc.inputTokens = (acc.inputTokens ?? 0) + usage.inputTokens;
  }
  if (usage.outputTokens !== undefined) {
    acc.outputTokens = (acc.outputTokens ?? 0) + usage.outputTokens;
  }
  if (usage.cacheReadTokens !== undefined) {
    acc.cacheReadTokens = (acc.cacheReadTokens ?? 0) + usage.cacheReadTokens;
  }
  if (usage.numTurns !== undefined) {
    acc.numTurns = (acc.numTurns ?? 0) + usage.numTurns;
  }
}

function summarizeUsage(results: ProblemResult[]): UsageSummary | undefined {
  const acc: UsageSummary = {};
  for (const r of results) {
    addUsage(acc, r.solveResult?.usage);
  }
  if (Object.keys(acc).length === 0) {
    return undefined;
  }
  return acc;
}

export function createReport(
  results: ProblemResult[],
  metadata?: {
    model?: string;
    contextProfile?: string;
    sdkVersion?: string;
    elapsedMs?: number;
    /** Git ref this run packed the SDK from. Undefined when no `--sdk-branch` was used. */
    sdkBranch?: string;
    /** Number of solve iterations per problem (1 for single-run mode). */
    iterationCount?: number;
  },
): ChallengeReport {
  const infraFailureCount = results.filter(isInfraFailure).length;
  const validResults = results.filter((r) => !isInfraFailure(r));

  const problemsTotal = results.length;
  const problemsPassed = results.filter(isPassed).length;

  // Exclude infra failures from cost calculation
  const totalCostUsd = validResults.reduce((sum, r) => sum + computeProblemCost(r), 0);

  // Valid-only pass rate (excluding infra failures)
  const validPassed = validResults.filter(isPassed).length;
  const validPercentage =
    validResults.length > 0 ? Math.round((validPassed / validResults.length) * 100) : 0;

  const costPerPass = totalCostUsd > 0 && validPassed > 0 ? totalCostUsd / validPassed : undefined;

  // Total duration: prefer wall-clock elapsed time (accurate for parallel runs)
  const totalDurationMs =
    metadata?.elapsedMs ?? results.reduce((sum, r) => sum + (r.totalDurationMs ?? 0), 0);

  const analytics = computeAnalytics(validResults, results);
  const usageSummary = summarizeUsage(validResults);

  return {
    timestamp: new Date().toISOString(),
    model: metadata?.model,
    contextProfile: metadata?.contextProfile,
    sdkVersion: metadata?.sdkVersion,
    ...(metadata?.sdkBranch ? { sdkBranch: metadata.sdkBranch } : {}),
    ...(metadata?.iterationCount !== undefined ? { iterationCount: metadata.iterationCount } : {}),
    results,
    problemsPassed,
    problemsTotal,
    percentage: problemsTotal > 0 ? Math.round((problemsPassed / problemsTotal) * 100) : 0,
    totalCostUsd,
    ...(costPerPass !== undefined ? { costPerPass } : {}),
    infraFailureCount,
    validPercentage,
    totalDurationMs,
    analytics,
    ...(usageSummary ? { usageSummary } : {}),
  };
}

export function formatReportTable(report: ChallengeReport): string {
  const hasCost = report.results.some((r) => r.solveResult !== undefined);
  const width = hasCost ? 90 : 78;

  const lines: string[] = [];
  lines.push("=".repeat(width));
  lines.push("Challenge Results");
  lines.push("=".repeat(width));
  lines.push("");

  let header = "Problem".padEnd(36) + "Difficulty".padEnd(12) + "Status".padEnd(12);
  if (hasCost) {
    header += "Cost";
  }
  lines.push(header);
  lines.push("-".repeat(width));

  for (const r of report.results) {
    const infraFailed = isInfraFailure(r);
    const nameRaw = problemKey(r.problemId, r.problemName);
    const name = (nameRaw.length > 35 ? `${nameRaw.slice(0, 34)}…` : nameRaw).padEnd(36);
    const diff = r.difficulty.padEnd(12);
    let statusLabel = "FAIL";
    if (infraFailed) {
      statusLabel = "INFRA";
    } else if (r.passed) {
      statusLabel = "PASS";
    }
    const status = statusLabel.padEnd(12);
    let line = `${name}${diff}${status}`;
    if (hasCost && r.solveResult && !infraFailed) {
      line += `$${computeProblemCost(r).toFixed(4)}`;
    }
    lines.push(line);

    if (!infraFailed) {
      for (const s of r.stages) {
        const stageName = `  ${s.stage}`.padEnd(36);
        let stageStatus = "FAIL";
        if (s.passed) {
          stageStatus = "ok";
        }
        const testCountLabel =
          s.testsTotal != null ? ` (${s.testsPassed ?? 0}/${s.testsTotal} tests)` : "";
        const durationLabel = s.durationMs != null ? ` ${(s.durationMs / 1000).toFixed(1)}s` : "";
        lines.push(`${stageName}${"".padEnd(12)}${stageStatus}${testCountLabel}${durationLabel}`);
      }

      // Iteration aggregate (Phase 4): when this result is the merged form of N
      // iterations, surface the pass rate and median±stdev for key metrics so
      // operators can sanity-check variance at a glance.
      const iterSummary = formatIterationSummary(r.iterations);
      if (iterSummary) {
        for (const line of iterSummary) {
          lines.push(`  ${line.padEnd(34)}${"".padEnd(12)}`);
        }
      }

      // Behavioural-trace summary (Phase 3): single line, compact form. Only
      // emitted when the metrics block exists (solve mode with stream-json).
      const traceSummary = formatProblemMetrics(r.metrics);
      if (traceSummary) {
        lines.push(`  ${"trace".padEnd(34)}${"".padEnd(12)}${traceSummary}`);
      }
    }
  }

  lines.push("-".repeat(width));
  let totalLine = `${"Total".padEnd(36)}${"".padEnd(12)}${`${report.problemsPassed}/${report.problemsTotal}`.padEnd(12)}${report.percentage}%`;
  if (hasCost) {
    totalLine += `  $${report.totalCostUsd.toFixed(4)}`;
  }
  lines.push(totalLine);

  // Valid score (excluding infra failures)
  if (report.infraFailureCount > 0) {
    lines.push(
      `${"Valid (excl. infra)".padEnd(36)}${"".padEnd(12)}${`${report.results.length - report.infraFailureCount}/${report.results.length}`.padEnd(12)}${report.validPercentage}%`,
    );
  }

  // Cost per passing problem
  if (report.costPerPass != null) {
    lines.push("");
    lines.push(`Cost per pass: $${report.costPerPass.toFixed(4)}`);
  }

  // Token usage (context-bloat sensor).
  if (report.usageSummary) {
    const u = report.usageSummary;
    const parts: string[] = [];
    if (u.inputTokens !== undefined) parts.push(`input=${u.inputTokens.toLocaleString()}`);
    if (u.outputTokens !== undefined) parts.push(`output=${u.outputTokens.toLocaleString()}`);
    if (u.cacheReadTokens !== undefined)
      parts.push(`cacheRead=${u.cacheReadTokens.toLocaleString()}`);
    if (u.numTurns !== undefined) parts.push(`turns=${u.numTurns}`);
    if (parts.length > 0) {
      lines.push(`Token usage:    ${parts.join("  |  ")}`);
    }
  }

  // Total duration
  if (report.totalDurationMs > 0) {
    const totalSecs = report.totalDurationMs / 1000;
    const mins = Math.floor(totalSecs / 60);
    const secs = Math.round(totalSecs % 60);
    lines.push(`Total duration: ${mins}m ${secs}s`);
  }

  // Infra failure summary
  if (report.infraFailureCount > 0) {
    lines.push("");
    lines.push(
      `WARNING: ${report.infraFailureCount} problem(s) skipped due to infrastructure failures (auth/network/rate-limit)`,
    );
  }

  // Scaffold modification warnings
  const scaffoldModified = report.results.filter(
    (r) => r.scaffoldChanges && r.scaffoldChanges.length > 0,
  );
  if (scaffoldModified.length > 0) {
    lines.push("");
    lines.push("WARNING: Scaffold files modified during solve (restored before verify):");
    for (const r of scaffoldModified) {
      const files = r.scaffoldChanges!.map((c) => c.file).join(", ");
      lines.push(`  ${problemKey(r.problemId, r.problemName)}: ${files}`);
    }
  }

  // All problems passed warning
  const validResults = report.results.filter((r) => !isInfraFailure(r));
  if (validResults.length > 0 && validResults.every(isPassed)) {
    lines.push("");
    lines.push(
      "WARNING: All problems passed -- consider increasing difficulty or adding harder problems",
    );
  }

  lines.push("=".repeat(width));

  // Analytics summary
  const { analytics } = report;

  const stageEntries = Object.entries(analytics.stagePassRates);
  if (stageEntries.length > 0) {
    lines.push("");
    lines.push("Stage Pass Rates:");
    for (const [key, rate] of stageEntries) {
      lines.push(`  ${key.padEnd(25)} ${rate.passed}/${rate.total} (${rate.rate}%)`);
    }
  }

  // Persistent failures (SDK improvement candidates) — list only stable_fail
  // entries; infra_failure is already summarised by the WARNING line above and
  // carries no SDK-affordance signal.
  const stableFailures = (analytics.persistentFailures ?? []).filter(
    (p) => p.reason === "stable_fail",
  );
  if (stableFailures.length > 0) {
    lines.push("");
    lines.push("Persistent failures (SDK improvement candidates):");
    for (const p of stableFailures) {
      lines.push(`  ${p.problemId}`);
    }
  }

  if (analytics.metricsSummary) {
    lines.push("");
    lines.push("Behaviour Metrics (per problem, n=" + analytics.metricsSummary.turns.count + "):");
    const fmt = (label: string, agg: MetricsSummary["turns"]): string =>
      `  ${label.padEnd(25)} min=${agg.min} median=${agg.median} max=${agg.max} mean=${agg.mean.toFixed(1)}`;
    lines.push(fmt("turns", analytics.metricsSummary.turns));
    lines.push(fmt("readSdkDts", analytics.metricsSummary.readSdkDts));
    lines.push(fmt("readDocs", analytics.metricsSummary.readDocs));
    lines.push(fmt("bashRetries", analytics.metricsSummary.bashRetries));
  }

  return lines.join("\n");
}

/**
 * Format an iteration aggregate as 1-2 short lines suitable for inclusion in
 * the per-problem table. Returns undefined when no iterations data exists.
 *
 *   iter pass=2/3 (67%) cost_median=$0.0234 cost_stdev=$0.0012
 *   iter turns=12±1.8 read_sdk=3±0.5 read_docs=2±0.0 bash_retries=4±2.1
 */
function formatIterationSummary(iterations?: IterationAggregate): string[] | undefined {
  if (!iterations || iterations.count <= 1) return undefined;
  const passPct = Math.round(iterations.passRate * 100);
  const lines: string[] = [];
  const costLabel = `cost_median=$${iterations.costMedian.toFixed(4)} cost_stdev=$${iterations.costStdev.toFixed(4)}`;
  lines.push(`iter pass=${iterations.passedCount}/${iterations.count} (${passPct}%) ${costLabel}`);
  const fmt = (key: "turns" | "readSdkDts" | "readDocs" | "bashRetries", label: string): string => {
    const med = iterations.metricsMedian[key];
    const sd = iterations.metricsStdev[key];
    // turns is the only integer-y value; we still show one decimal for stdev so
    // small variances are readable.
    return `${label}=${med.toFixed(1)}±${sd.toFixed(1)}`;
  };
  lines.push(
    `iter ${fmt("turns", "turns")} ${fmt("readSdkDts", "read_sdk")} ${fmt("readDocs", "read_docs")} ${fmt("bashRetries", "bash_retries")}`,
  );
  return lines;
}

/**
 * Format a problem's metrics as a single space-separated line, e.g.
 *   turns=12 read_sdk=4 read_docs=2 bash_retries=3
 * Returns undefined when there are no metrics to surface.
 */
function formatProblemMetrics(metrics?: TraceMetrics): string | undefined {
  if (!metrics) return undefined;
  // Suppress when every counter is zero — for `--use-solution` runs the trace
  // file may exist but contain no events.
  if (
    metrics.turns === 0 &&
    metrics.readSdkDts === 0 &&
    metrics.readDocs === 0 &&
    metrics.bashRetries === 0
  ) {
    return undefined;
  }
  const parts = [
    `turns=${metrics.turns}`,
    `read_sdk=${metrics.readSdkDts}`,
    `read_docs=${metrics.readDocs}`,
    `bash_retries=${metrics.bashRetries}`,
  ];
  return parts.join(" ");
}
