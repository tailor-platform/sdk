import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { problemKey, requireArg } from "../shared/helpers";
import { ITERATION_METRIC_KEYS, type IterationMetricKey } from "./report";
import type { ChallengeReport, ProblemResult } from "./report";
import { parseSolveModelLabel } from "./solve-model";

const challengeRoot = path.resolve(import.meta.dirname, "..");

type GroupKey = {
  agent: string;
  model: string;
  contextProfile: string;
};

/**
 * Derive an `(agent, model, contextProfile)` grouping key from a report.
 *
 * The `model` field follows two shapes:
 * - Solve runs use `"agent:model"` (e.g. `"claude:sonnet"`).
 * - Pre-`agent:` runs stored only the model (e.g. `"sonnet"`); recovered as
 *   `{ agent: "claude", model }`.
 *
 * Reports without a `model` (solution-verify runs) are grouped under a
 * dedicated sentinel so they do not pollute solver groups.
 */
function getGroupKey(report: ChallengeReport): GroupKey {
  if (!report.model) {
    return {
      agent: "solution",
      model: "verify",
      contextProfile: report.contextProfile || "unknown",
    };
  }
  const { agent, model } = parseSolveModelLabel(report.model);
  return {
    agent,
    model: model ?? "default",
    contextProfile: report.contextProfile || "unknown",
  };
}

function formatGroupKey(key: GroupKey): string {
  return `${key.agent}:${key.model} / ${key.contextProfile}`;
}

function groupKeyId(key: GroupKey): string {
  return `${key.agent}|${key.model}|${key.contextProfile}`;
}

type Filters = {
  agent?: string;
  model?: string;
  contextProfile?: string;
};

type ParsedArgs = Filters & {
  trend: boolean;
  groups: boolean;
  /** When set, treat these two paths as the A/B pair to diff. */
  diffPair?: [string, string];
  /** When true, emit JSON instead of the table. Only honored by --diff. */
  json: boolean;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let trend = false;
  let groups = false;
  let agent: string | undefined;
  let model: string | undefined;
  let contextProfile: string | undefined;
  let diffPair: [string, string] | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--trend":
        trend = true;
        break;
      case "--groups":
        groups = true;
        break;
      case "--diff": {
        const a = requireArg(args, i, "--diff");
        i++;
        const b = requireArg(args, i, "--diff");
        i++;
        diffPair = [a, b];
        break;
      }
      case "--json":
        json = true;
        break;
      case "--agent":
        agent = requireArg(args, i, "--agent");
        i++;
        break;
      case "--model":
        model = requireArg(args, i, "--model");
        i++;
        break;
      case "--context-profile":
        contextProfile = requireArg(args, i, "--context-profile");
        i++;
        break;
    }
  }

  return {
    trend,
    groups,
    agent,
    model,
    contextProfile,
    ...(diffPair ? { diffPair } : {}),
    json,
  };
}

function matchesFilters(key: GroupKey, filters: Filters): boolean {
  if (filters.agent && key.agent !== filters.agent) return false;
  if (filters.model && key.model !== filters.model) return false;
  if (filters.contextProfile && key.contextProfile !== filters.contextProfile) return false;
  return true;
}

function loadReports(filters: Filters = {}): ChallengeReport[] {
  const resultsDir = path.join(challengeRoot, "results");
  if (!fs.existsSync(resultsDir)) {
    console.error("No results directory found");
    process.exit(1);
  }

  const files = listReportFiles(resultsDir);

  if (files.length === 0) {
    console.error("No report files found under results/");
    process.exit(1);
  }

  const reports: ChallengeReport[] = [];
  for (const f of files) {
    try {
      const content = fs.readFileSync(f, "utf-8");
      const report = JSON.parse(content) as ChallengeReport;
      if (!matchesFilters(getGroupKey(report), filters)) continue;
      reports.push(report);
    } catch {
      console.warn(`Skipping malformed report file: ${path.relative(resultsDir, f)}`);
    }
  }
  return reports.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function listReportFiles(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "artifacts") continue;
      out.push(...listReportFiles(full));
    } else if (ent.isFile() && ent.name.startsWith("report-") && ent.name.endsWith(".json")) {
      out.push(full);
    }
  }
  return out;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function showTrend(reports: ChallengeReport[], groupLabel: string): void {
  const width = 80;
  console.log("=".repeat(width));
  console.log(`Pass-Rate Trend -- ${groupLabel}`);
  console.log("=".repeat(width));
  console.log("");

  const header =
    "Timestamp".padEnd(22) + "Model".padEnd(14) + "Passed".padEnd(12) + "Pct".padEnd(8) + "Cost";
  console.log(header);
  console.log("-".repeat(width));

  for (const r of reports) {
    const ts = formatTimestamp(r.timestamp);
    const model = (r.model ?? "-").slice(0, 13).padEnd(14);
    const passed = `${r.problemsPassed}/${r.problemsTotal}`.padEnd(12);
    const pct = `${r.percentage}%`.padEnd(8);
    const cost = r.totalCostUsd > 0 ? `$${r.totalCostUsd.toFixed(4)}` : "-";
    console.log(`${ts}  ${model}${passed}${pct}${cost}`);
  }

  console.log("-".repeat(width));
  console.log("");

  // Per-problem trend
  const problemKeySet = new Set<string>();
  for (const r of reports) {
    for (const p of r.results) {
      problemKeySet.add(problemKey(p.problemId, p.problemName));
    }
  }
  const allProblemKeys = [...problemKeySet].sort();

  if (reports.length >= 2) {
    console.log("Per-Problem Progression:");
    const probHeader = "Problem".padEnd(30) + reports.map((_, i) => `R${i + 1}`.padEnd(8)).join("");
    console.log(probHeader);
    console.log("-".repeat(30 + reports.length * 8));

    for (const key of allProblemKeys) {
      let line = key.slice(0, 29).padEnd(30);
      for (const report of reports) {
        const result = report.results.find((r) => problemKey(r.problemId, r.problemName) === key);
        let cell = "-";
        if (result) {
          cell = result.passed ? "PASS" : "FAIL";
        }
        line += cell.padEnd(8);
      }
      console.log(line);
    }
    console.log("");
  }

  // Compare affordance distribution between the first (baseline) and last
  // (latest) reports. Only emit when at least one of them carries non-empty
  // distribution data — otherwise the section is just noise.
  if (reports.length >= 2) {
    const baseline = reports[0]!;
    const latest = reports[reports.length - 1]!;
    const baselineDist = baseline.analytics?.affordanceDistribution ?? {};
    const latestDist = latest.analytics?.affordanceDistribution ?? {};
    showAffordanceDelta(baselineDist, latestDist);
  }

  console.log("=".repeat(width));
}

function showAffordanceDelta(
  baseline: Record<string, number>,
  latest: Record<string, number>,
): void {
  const labels = new Set([...Object.keys(baseline), ...Object.keys(latest)]);
  if (labels.size === 0) return;

  console.log("Affordance Distribution (baseline -> latest):");
  const rows: { label: string; base: number; cur: number; delta: number }[] = [];
  for (const label of labels) {
    const base = baseline[label] ?? 0;
    const cur = latest[label] ?? 0;
    rows.push({ label, base, cur, delta: cur - base });
  }
  // Sort by largest absolute delta, then by current count.
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.cur - a.cur);
  for (const row of rows) {
    const deltaLabel = row.delta === 0 ? "0" : row.delta > 0 ? `+${row.delta}` : `${row.delta}`;
    console.log(`  ${row.label.padEnd(28)} ${row.base} -> ${row.cur} (${deltaLabel})`);
  }
  console.log("");
}

function groupReports(
  reports: ChallengeReport[],
): Map<string, { key: GroupKey; reports: ChallengeReport[] }> {
  const groups = new Map<string, { key: GroupKey; reports: ChallengeReport[] }>();
  for (const r of reports) {
    const key = getGroupKey(r);
    const id = groupKeyId(key);
    const existing = groups.get(id);
    if (existing) {
      existing.reports.push(r);
    } else {
      groups.set(id, { key, reports: [r] });
    }
  }
  return groups;
}

function showGroupsOverview(reports: ChallengeReport[]): void {
  const groups = groupReports(reports);

  const width = 80;
  console.log("=".repeat(width));
  console.log("Report Groups");
  console.log("=".repeat(width));
  console.log("");
  console.log("Group".padEnd(50) + "Reports".padEnd(10) + "Latest".padEnd(22) + "Latest pass rate");
  console.log("-".repeat(width));

  const sorted = [...groups.values()].sort((a, b) => {
    const ta = Math.max(...a.reports.map((r) => new Date(r.timestamp).getTime()));
    const tb = Math.max(...b.reports.map((r) => new Date(r.timestamp).getTime()));
    return tb - ta;
  });

  for (const { key, reports: rs } of sorted) {
    const latest = rs.reduce((acc, r) =>
      new Date(r.timestamp).getTime() > new Date(acc.timestamp).getTime() ? r : acc,
    );
    const label = formatGroupKey(key).slice(0, 49).padEnd(50);
    const count = String(rs.length).padEnd(10);
    const ts = formatTimestamp(latest.timestamp).padEnd(22);
    const passRate = `${latest.problemsPassed}/${latest.problemsTotal} (${latest.percentage}%)`;
    console.log(`${label}${count}${ts}${passRate}`);
  }
  console.log("-".repeat(width));
  console.log("");
  console.log(
    "Tip: narrow with --agent / --model / --context-profile, or use --trend to see history.",
  );
}

function describeFilters(filters: Filters): string {
  const parts: string[] = [];
  if (filters.agent) parts.push(`agent=${filters.agent}`);
  if (filters.model) parts.push(`model=${filters.model}`);
  if (filters.contextProfile) parts.push(`context-profile=${filters.contextProfile}`);
  return parts.length === 0 ? "any" : parts.join(", ");
}

/**
 * Per-problem delta row in an A/B diff. `passRateA` / `passRateB` are
 * fractions in [0, 1] derived from either the iteration aggregate (when
 * `iterations.count > 1`) or the binary `passed` flag (= 0 or 1) for
 * single-iteration reports.
 *
 * `status` is `"added"` when the problem only appears in B, `"removed"` when
 * only in A, otherwise `"present"` — callers render the table accordingly.
 */
export type DiffRow = {
  problemKey: string;
  status: "present" | "added" | "removed";
  passRateA: number | null;
  passRateB: number | null;
  passRateDelta: number | null;
  costMedianA: number | null;
  costMedianB: number | null;
  costMedianDelta: number | null;
  metricsDelta: {
    turns: number | null;
    readSdkDts: number | null;
    readDocs: number | null;
    bashRetries: number | null;
  };
};

export type DiffReport = {
  reportA: {
    path: string;
    timestamp?: string;
    model?: string;
    contextProfile?: string;
    sdkVersion?: string;
    sdkBranch?: string;
    iterationCount?: number;
  };
  reportB: {
    path: string;
    timestamp?: string;
    model?: string;
    contextProfile?: string;
    sdkVersion?: string;
    sdkBranch?: string;
    iterationCount?: number;
  };
  rows: DiffRow[];
  /** Aggregate pass-rate delta across overlapping problems (B − A). */
  overallPassRateDelta: number;
  /**
   * Cost delta (B − A) summed across overlapping problems. Honors the median
   * from `iterations` when present, falling back to per-problem `solveResult.costUsd`.
   */
  totalCostDelta: number;
  /**
   * Affordance label delta: for each label present in either report,
   * (countB − countA). Includes labels with zero on one side.
   */
  affordanceDelta: Record<string, { a: number; b: number; delta: number }>;
  warnings: string[];
};

/**
 * Extract the per-problem pass rate for diff purposes. Multi-iteration runs
 * expose `iterations.passRate` directly; single-iteration runs are 0/1 based
 * on the binary `passed` flag.
 */
function getPassRate(result: ProblemResult): number {
  return result.iterations?.passRate ?? (result.passed ? 1 : 0);
}

/**
 * Extract the per-problem cost (preferring the iteration median when present
 * so single-shot vs N-iteration comparisons remain on the same scale).
 */
function getCost(result: ProblemResult): number {
  return result.iterations?.costMedian ?? result.solveResult?.costUsd ?? 0;
}

function getMetric(result: ProblemResult, key: IterationMetricKey): number | null {
  if (result.iterations) {
    return result.iterations.metricsMedian[key];
  }
  if (result.metrics) {
    return result.metrics[key];
  }
  return null;
}

function indexResultsByKey(report: ChallengeReport): Map<string, ProblemResult> {
  const out = new Map<string, ProblemResult>();
  for (const r of report.results) {
    out.set(problemKey(r.problemId, r.problemName), r);
  }
  return out;
}

/** Strip-undefined helper for the diff envelope — keeps `JSON.stringify` clean. */
function buildReportEnvelope(report: ChallengeReport, diffPath: string): DiffReport["reportA"] {
  return {
    path: diffPath,
    ...(report.timestamp ? { timestamp: report.timestamp } : {}),
    ...(report.model ? { model: report.model } : {}),
    ...(report.contextProfile ? { contextProfile: report.contextProfile } : {}),
    ...(report.sdkVersion ? { sdkVersion: report.sdkVersion } : {}),
    ...(report.sdkBranch ? { sdkBranch: report.sdkBranch } : {}),
    ...(report.iterationCount !== undefined ? { iterationCount: report.iterationCount } : {}),
  };
}

/**
 * Build a structured A/B diff between two `ChallengeReport`s. Pure function —
 * tests can call it directly with synthetic data without touching `fs`.
 *
 * Edge cases handled:
 * - Problems only in A: emitted with `status: "removed"`, `passRateB = null`.
 * - Problems only in B: emitted with `status: "added"`, `passRateA = null`.
 * - iterationCount mismatch: surfaced via the `warnings` field; deltas still
 *   computed because pass-rate is normalized to [0, 1].
 */
export function computeReportDiff(
  reportA: ChallengeReport,
  reportB: ChallengeReport,
  paths: { a: string; b: string } = { a: "<reportA>", b: "<reportB>" },
): DiffReport {
  const indexA = indexResultsByKey(reportA);
  const indexB = indexResultsByKey(reportB);
  const allKeys = new Set<string>([...indexA.keys(), ...indexB.keys()]);
  const rows: DiffRow[] = [];
  const overlapKeys: string[] = [];

  for (const key of [...allKeys].sort()) {
    const a = indexA.get(key);
    const b = indexB.get(key);
    let status: DiffRow["status"];
    if (a && b) status = "present";
    else if (b) status = "added";
    else status = "removed";

    if (status === "present") overlapKeys.push(key);

    const passRateA = a ? getPassRate(a) : null;
    const passRateB = b ? getPassRate(b) : null;
    const passRateDelta = passRateA !== null && passRateB !== null ? passRateB - passRateA : null;

    const costMedianA = a ? getCost(a) : null;
    const costMedianB = b ? getCost(b) : null;
    const costMedianDelta =
      costMedianA !== null && costMedianB !== null ? costMedianB - costMedianA : null;

    const metricsDelta: DiffRow["metricsDelta"] = {
      turns: null,
      readSdkDts: null,
      readDocs: null,
      bashRetries: null,
    };
    if (a && b) {
      for (const k of ITERATION_METRIC_KEYS) {
        const ma = getMetric(a, k);
        const mb = getMetric(b, k);
        metricsDelta[k] = ma !== null && mb !== null ? mb - ma : null;
      }
    }

    rows.push({
      problemKey: key,
      status,
      passRateA,
      passRateB,
      passRateDelta,
      costMedianA,
      costMedianB,
      costMedianDelta,
      metricsDelta,
    });
  }

  // Overall pass-rate delta over the OVERLAPPING set so added/removed problems
  // don't artificially inflate the delta in either direction.
  let overallPassRateDelta = 0;
  if (overlapKeys.length > 0) {
    let sumA = 0;
    let sumB = 0;
    for (const key of overlapKeys) {
      sumA += getPassRate(indexA.get(key)!);
      sumB += getPassRate(indexB.get(key)!);
    }
    overallPassRateDelta = (sumB - sumA) / overlapKeys.length;
  }

  // Total cost delta over overlapping problems only (same reasoning).
  let totalCostDelta = 0;
  for (const key of overlapKeys) {
    totalCostDelta += getCost(indexB.get(key)!) - getCost(indexA.get(key)!);
  }

  const distA = reportA.analytics?.affordanceDistribution ?? {};
  const distB = reportB.analytics?.affordanceDistribution ?? {};
  const labels = new Set<string>([...Object.keys(distA), ...Object.keys(distB)]);
  const affordanceDelta: DiffReport["affordanceDelta"] = {};
  for (const label of labels) {
    const aCount = distA[label] ?? 0;
    const bCount = distB[label] ?? 0;
    affordanceDelta[label] = { a: aCount, b: bCount, delta: bCount - aCount };
  }

  const warnings: string[] = [];
  if (
    reportA.iterationCount !== undefined &&
    reportB.iterationCount !== undefined &&
    reportA.iterationCount !== reportB.iterationCount
  ) {
    warnings.push(
      `iterationCount mismatch: A=${reportA.iterationCount} vs B=${reportB.iterationCount}; deltas use normalized pass rates.`,
    );
  }
  if (
    reportA.contextProfile !== undefined &&
    reportB.contextProfile !== undefined &&
    reportA.contextProfile !== reportB.contextProfile
  ) {
    warnings.push(
      `contextProfile differs: A=${reportA.contextProfile} vs B=${reportB.contextProfile}.`,
    );
  }
  if (
    reportA.model !== undefined &&
    reportB.model !== undefined &&
    reportA.model !== reportB.model
  ) {
    warnings.push(`model differs: A=${reportA.model} vs B=${reportB.model}.`);
  }

  return {
    reportA: buildReportEnvelope(reportA, paths.a),
    reportB: buildReportEnvelope(reportB, paths.b),
    rows,
    overallPassRateDelta,
    totalCostDelta,
    affordanceDelta,
    warnings,
  };
}

function loadReportFile(filePath: string): ChallengeReport {
  if (!fs.existsSync(filePath)) {
    console.error(`Report not found: ${filePath}`);
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(content) as ChallengeReport;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to parse report ${filePath}: ${message}`);
    process.exit(1);
  }
}

/**
 * Format a numeric delta with a leading sign, e.g. `+0.33` / `-0.10` / `0.00`.
 */
export function formatDelta(value: number, fractionDigits = 2): string {
  if (value === 0) return (0).toFixed(fractionDigits);
  return (value > 0 ? "+" : "") + value.toFixed(fractionDigits);
}

function formatPct(value: number | null): string {
  if (value === null) return "  -  ";
  return `${Math.round(value * 100)}%`;
}

function showDiff(diff: DiffReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(diff, null, 2));
    return;
  }
  const width = 96;
  console.log("=".repeat(width));
  console.log("A/B Diff");
  console.log("=".repeat(width));
  console.log(`A: ${diff.reportA.path}`);
  console.log(`B: ${diff.reportB.path}`);
  if (diff.reportA.sdkBranch || diff.reportB.sdkBranch) {
    console.log(
      `  sdkBranch: A=${diff.reportA.sdkBranch ?? "-"}  B=${diff.reportB.sdkBranch ?? "-"}`,
    );
  }
  if (diff.reportA.iterationCount !== undefined || diff.reportB.iterationCount !== undefined) {
    console.log(
      `  iterations: A=${diff.reportA.iterationCount ?? "-"}  B=${diff.reportB.iterationCount ?? "-"}`,
    );
  }
  for (const w of diff.warnings) {
    console.log(`  WARNING: ${w}`);
  }
  console.log("");

  console.log(
    "Problem".padEnd(38) +
      "passA".padEnd(8) +
      "passB".padEnd(8) +
      "Δpass".padEnd(10) +
      "ΔcostUSD".padEnd(12) +
      "Δturns",
  );
  console.log("-".repeat(width));
  for (const row of diff.rows) {
    const key = row.problemKey.slice(0, 37).padEnd(38);
    const passA = formatPct(row.passRateA).padEnd(8);
    const passB = formatPct(row.passRateB).padEnd(8);
    const dpass = row.passRateDelta !== null ? formatDelta(row.passRateDelta, 2) : "  -  ";
    const dcost = row.costMedianDelta !== null ? formatDelta(row.costMedianDelta, 4) : "  -  ";
    const dturns =
      row.metricsDelta.turns !== null ? formatDelta(row.metricsDelta.turns, 1) : "  -  ";
    const tag = row.status === "present" ? "" : `  [${row.status}]`;
    console.log(`${key}${passA}${passB}${dpass.padEnd(10)}${dcost.padEnd(12)}${dturns}${tag}`);
  }
  console.log("-".repeat(width));
  console.log(`Overall ΔpassRate: ${formatDelta(diff.overallPassRateDelta, 3)}`);
  console.log(`Total ΔcostUSD:    ${formatDelta(diff.totalCostDelta, 4)}`);
  console.log("");

  const labels = Object.keys(diff.affordanceDelta);
  if (labels.length > 0) {
    console.log("Affordance distribution (A → B):");
    const sorted = [...Object.entries(diff.affordanceDelta)].sort(
      (x, y) => Math.abs(y[1].delta) - Math.abs(x[1].delta) || y[1].b - x[1].b,
    );
    for (const [label, counts] of sorted) {
      const deltaLabel =
        counts.delta === 0 ? "0" : counts.delta > 0 ? `+${counts.delta}` : `${counts.delta}`;
      console.log(`  ${label.padEnd(28)} ${counts.a} -> ${counts.b} (${deltaLabel})`);
    }
    console.log("");
  }
  console.log("=".repeat(width));
}

function main(): void {
  const { trend, groups, agent, model, contextProfile, diffPair, json } = parseArgs();
  const filters: Filters = { agent, model, contextProfile };

  if (diffPair) {
    const [pathA, pathB] = diffPair;
    const reportA = loadReportFile(pathA);
    const reportB = loadReportFile(pathB);
    const diff = computeReportDiff(reportA, reportB, { a: pathA, b: pathB });
    showDiff(diff, json);
    return;
  }

  if (groups) {
    const reports = loadReports(filters);
    if (reports.length === 0) {
      console.error(`No report groups match filters (${describeFilters(filters)}).`);
      process.exit(1);
    }
    showGroupsOverview(reports);
    return;
  }

  const filtered = loadReports(filters);

  if (trend) {
    if (filtered.length === 0) {
      console.error(`No reports match filters (${describeFilters(filters)}).`);
      console.error("Run 'pnpm challenge:analyze --groups' to list available groups.");
      process.exit(1);
    }
    showTrend(filtered, describeFilters(filters));
    return;
  }

  // Default: trend within the most recently active matching group.
  const eligible = [...groupReports(filtered).values()].filter((g) => g.reports.length >= 1);
  if (eligible.length === 0) {
    console.error(`No reports match filters (${describeFilters(filters)}).`);
    console.error("Run 'pnpm challenge:analyze --groups' to see what's available.");
    process.exit(1);
  }

  eligible.sort((a, b) => {
    const ta = new Date(a.reports[a.reports.length - 1]!.timestamp).getTime();
    const tb = new Date(b.reports[b.reports.length - 1]!.timestamp).getTime();
    return tb - ta;
  });
  const chosen = eligible[0]!;
  const sorted = [...chosen.reports].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  showTrend(sorted, formatGroupKey(chosen.key));
}

// Only auto-run when invoked directly via `tsx core/analyze.ts`, so importing
// from tests (vitest) does not kick off the analyzer.
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
