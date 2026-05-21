import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { problemKey, requireArg, sanitizeForFilename } from "../shared/helpers";
import { READ_TARGET_CLASSES, type ReadTargetClass } from "./metrics";
import { ITERATION_METRIC_KEYS, type IterationMetricKey } from "./report";
import type { ChallengeReport, ProblemResult } from "./report";

const challengeRoot = path.resolve(import.meta.dirname, "..");

/**
 * Walk every `problems/<id>/meta.json` and produce a map from each declared
 * alias (older problem ID) to the current canonical ID. With
 * `--unify-aliases`, the analyzer rewrites historical report rows through
 * this map so renamed problems show a single continuous history.
 */
export function buildAliasMap(root: string = challengeRoot): Map<string, string> {
  const out = new Map<string, string>();
  const problemsDir = path.join(root, "problems");
  if (!fs.existsSync(problemsDir)) return out;
  for (const ent of fs.readdirSync(problemsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const metaPath = path.join(problemsDir, ent.name, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as {
        id?: string;
        aliases?: string[];
      };
      const id = meta.id;
      if (!id) continue;
      for (const alias of meta.aliases ?? []) {
        out.set(alias, id);
      }
    } catch {
      // tolerate malformed meta.json — analyzer should not crash on it
    }
  }
  return out;
}

export function canonicalProblemId(id: string, aliasMap: Map<string, string>): string {
  return aliasMap.get(id) ?? id;
}

/**
 * Set of problem IDs that have been moved to `problems/archived/`. Used by
 * default to filter out graduated problems from trend / diff renderers so
 * they don't dilute the active-set signal. Surfaced as an `--include-archived`
 * flag for the rare case an operator wants the full historical pass-rate.
 */
export function buildArchivedIdSet(root: string = challengeRoot): Set<string> {
  const out = new Set<string>();
  const archivedDir = path.join(root, "problems", "archived");
  if (!fs.existsSync(archivedDir)) return out;
  for (const ent of fs.readdirSync(archivedDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const metaPath = path.join(archivedDir, ent.name, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as { id?: string };
      if (meta.id) out.add(meta.id);
    } catch {
      // tolerate malformed meta.json
    }
  }
  return out;
}

type GroupKey = {
  /** "solution-verify" for reference-impl runs, otherwise the OSS model id. */
  model: string;
  contextProfile: string;
};

/**
 * Derive a `(model, contextProfile)` grouping key from a report.
 *
 * Reports without a `model` (solution-verify runs) are grouped under a
 * dedicated sentinel so they do not pollute solver groups.
 */
function getGroupKey(report: ChallengeReport): GroupKey {
  if (!report.model) {
    return {
      model: "solution-verify",
      contextProfile: report.contextProfile || "unknown",
    };
  }
  return {
    model: report.model ?? "",
    contextProfile: report.contextProfile || "unknown",
  };
}

function formatGroupKey(key: GroupKey): string {
  return `${key.model} / ${key.contextProfile}`;
}

function groupKeyId(key: GroupKey): string {
  return `${key.model}|${key.contextProfile}`;
}

type Filters = {
  model?: string;
  contextProfile?: string;
};

type ParsedArgs = Filters & {
  trend: boolean;
  groups: boolean;
  /**
   * When true, locate the most-recent code-only and code-and-docs reports
   * for the active model group and emit the diff between them. Surfaces the
   * docs-vs-types-gap signal automatically.
   */
  profileDiff: boolean;
  /** When set, treat these two paths as the A/B pair to diff. */
  diffPair?: [string, string];
  /** When true, emit JSON instead of the table. Only honored by --diff. */
  json: boolean;
  /**
   * When true, resolve each report's `problemId` through the alias map built
   * from current `meta.json` files (`aliases?: string[]`). Lets trend/diff
   * aggregate the same logical problem across rename boundaries. Off by
   * default so analyzers see the raw IDs that landed in the report.
   */
  unifyAliases: boolean;
  /**
   * When true, include archived problems (under `problems/archived/`) in
   * the analysis. Default omits them — graduated problems are not part of
   * active rotation. Useful when stitching trend lines across a graduation
   * boundary.
   */
  includeArchived: boolean;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let trend = false;
  let groups = false;
  let profileDiff = false;
  let model: string | undefined;
  let contextProfile: string | undefined;
  let diffPair: [string, string] | undefined;
  let json = false;
  let unifyAliases = false;
  let includeArchived = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--trend":
        trend = true;
        break;
      case "--groups":
        groups = true;
        break;
      case "--profile-diff":
        profileDiff = true;
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
      case "--model":
        model = requireArg(args, i, "--model");
        i++;
        break;
      case "--context-profile":
        contextProfile = requireArg(args, i, "--context-profile");
        i++;
        break;
      case "--unify-aliases":
        unifyAliases = true;
        break;
      case "--include-archived":
        includeArchived = true;
        break;
    }
  }

  return {
    trend,
    groups,
    profileDiff,
    model,
    contextProfile,
    ...(diffPair ? { diffPair } : {}),
    json,
    unifyAliases,
    includeArchived,
  };
}

function matchesFilters(key: GroupKey, filters: Filters): boolean {
  if (filters.model && key.model !== filters.model) return false;
  if (filters.contextProfile && key.contextProfile !== filters.contextProfile) return false;
  return true;
}

function loadReports(
  filters: Filters = {},
  options: { includeArchived?: boolean } = {},
): ChallengeReport[] {
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

  const archivedIds = options.includeArchived ? null : buildArchivedIdSet();

  const reports: ChallengeReport[] = [];
  for (const f of files) {
    try {
      const content = fs.readFileSync(f, "utf-8");
      const report = JSON.parse(content) as ChallengeReport;
      if (!matchesFilters(getGroupKey(report), filters)) continue;
      // Strip archived problem results so trend / diff renderers see the
      // active set only. The report's aggregate counters (problemsPassed,
      // percentage) still reflect the original numbers — analyzers care
      // about the per-problem rows, not the headline pass rate, when
      // archived filtering is meaningful.
      if (archivedIds && archivedIds.size > 0) {
        report.results = report.results.filter((r) => !archivedIds.has(r.problemId));
      }
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

function showTrend(
  reports: ChallengeReport[],
  groupLabel: string,
  aliasMap?: Map<string, string>,
): void {
  const width = 72;
  console.log("=".repeat(width));
  console.log(`Pass-Rate Trend -- ${groupLabel}`);
  console.log("=".repeat(width));
  console.log("");

  const header = "Timestamp".padEnd(22) + "Model".padEnd(20) + "Passed".padEnd(12) + "Pct";
  console.log(header);
  console.log("-".repeat(width));

  for (const r of reports) {
    const ts = formatTimestamp(r.timestamp);
    const model = (r.model ?? "-").slice(0, 19).padEnd(20);
    const passed = `${r.problemsPassed}/${r.problemsTotal}`.padEnd(12);
    const pct = `${r.percentage}%`;
    console.log(`${ts}  ${model}${passed}${pct}`);
  }

  console.log("-".repeat(width));
  console.log("");

  // Per-problem trend. With aliasMap, normalize each result's problemId so a
  // renamed problem (m22-old → m22-new) appears on one row across history.
  const canonicalKey = (r: ProblemResult): string => {
    const id = aliasMap ? canonicalProblemId(r.problemId, aliasMap) : r.problemId;
    return problemKey(id, r.problemName);
  };
  const problemKeySet = new Set<string>();
  for (const r of reports) {
    for (const p of r.results) {
      problemKeySet.add(canonicalKey(p));
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
        const result = report.results.find((r) => canonicalKey(r) === key);
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

  console.log("=".repeat(width));
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
  console.log("Tip: narrow with --model / --context-profile, or use --trend to see history.");
}

function describeFilters(filters: Filters): string {
  const parts: string[] = [];
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
 * `stdevTurnsA` / `stdevTurnsB` carry `iterations.metricsStdev.turns` so the
 * table reader can sanity-check delta magnitude against inter-iteration noise.
 * Both are null when the corresponding side did not run multiple iterations.
 *
 * `readDeltas` exposes the per-bucket `readTargets` deltas
 * ({@link ReadTargetClass}). Phase 5b validation showed the `readTargets`
 * signal is multi-bucket (m05 differs on `sdk-docs`, m18 on `sdk-dts` +
 * `problem-files`), so summarising to `turns` alone hides the affordance gap.
 * Buckets missing from either side fall back to 0, letting pre-Phase-5b
 * reports surface as no-delta rather than crashing.
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
  /** `iterations.metricsStdev.turns` from A (null for single-iteration reports). */
  stdevTurnsA: number | null;
  /** `iterations.metricsStdev.turns` from B (null for single-iteration reports). */
  stdevTurnsB: number | null;
  metricsDelta: {
    turns: number | null;
    readSdkDts: number | null;
    readDocs: number | null;
    bashRetries: number | null;
  };
  readDeltas: Record<ReadTargetClass, number | null>;
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

function getMetric(result: ProblemResult, key: IterationMetricKey): number | null {
  if (result.iterations) {
    return result.iterations.metricsMedian[key];
  }
  if (result.metrics) {
    return result.metrics[key];
  }
  return null;
}

/**
 * Extract the per-bucket readTargets count for diff purposes. Prefers the
 * iteration median when present; falls back to the single-iteration
 * `metrics.readTargets` map when available.
 *
 * For pre-Phase-5b reports that have no per-bucket data we fall back to the
 * legacy `readSdkDts` / `readDocs` aggregates for the `sdk-dts` / `sdk-docs`
 * buckets respectively, so the read-deltas line still surfaces SOMETHING
 * useful instead of a flat row. Buckets without a legacy equivalent stay
 * null (and the renderer omits them from the line).
 */
function getReadTargetCount(result: ProblemResult, bucket: ReadTargetClass): number | null {
  const legacyKey: Partial<Record<ReadTargetClass, IterationMetricKey>> = {
    "sdk-dts": "readSdkDts",
    "sdk-docs": "readDocs",
  };
  if (result.iterations) {
    const direct = result.iterations.metricsMedian[bucket];
    if (typeof direct === "number") return direct;
    const legacy = legacyKey[bucket];
    if (legacy) {
      const value = result.iterations.metricsMedian[legacy];
      return typeof value === "number" ? value : null;
    }
    return null;
  }
  if (result.metrics?.readTargets) {
    const direct = result.metrics.readTargets[bucket];
    if (typeof direct === "number") return direct;
  }
  if (result.metrics) {
    const legacy = legacyKey[bucket];
    if (legacy) {
      const value = result.metrics[legacy];
      return typeof value === "number" ? value : null;
    }
  }
  return null;
}

/**
 * Pull `iterations.metricsStdev.turns` from a result, returning null when no
 * iteration aggregate exists (single-iteration runs have no variance metric).
 */
function getTurnsStdev(result: ProblemResult): number | null {
  if (!result.iterations) return null;
  const value = result.iterations.metricsStdev.turns;
  return typeof value === "number" ? value : null;
}

function indexResultsByKey(
  report: ChallengeReport,
  aliasMap?: Map<string, string>,
): Map<string, ProblemResult> {
  const out = new Map<string, ProblemResult>();
  for (const r of report.results) {
    const id = aliasMap ? canonicalProblemId(r.problemId, aliasMap) : r.problemId;
    out.set(problemKey(id, r.problemName), r);
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
  options: { aliasMap?: Map<string, string> } = {},
): DiffReport {
  const indexA = indexResultsByKey(reportA, options.aliasMap);
  const indexB = indexResultsByKey(reportB, options.aliasMap);
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

    const readDeltas: DiffRow["readDeltas"] = {
      "sdk-dts": null,
      "sdk-package-src": null,
      "sdk-docs": null,
      "problem-files": null,
      other: null,
    };
    if (a && b) {
      for (const bucket of READ_TARGET_CLASSES) {
        const ra = getReadTargetCount(a, bucket);
        const rb = getReadTargetCount(b, bucket);
        readDeltas[bucket] = ra !== null && rb !== null ? rb - ra : null;
      }
    }

    rows.push({
      problemKey: key,
      status,
      passRateA,
      passRateB,
      passRateDelta,
      stdevTurnsA: a ? getTurnsStdev(a) : null,
      stdevTurnsB: b ? getTurnsStdev(b) : null,
      metricsDelta,
      readDeltas,
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
    warnings,
  };
}

/**
 * Resolve the active `code-only` vs `code-and-docs` report pair for the
 * profile-diff mode. Implementation strategy:
 *
 * 1. Load every report and group by `model` (the contextProfile is
 *    intentionally dropped from the grouping so the two profile variants land
 *    in the same bucket).
 * 2. Pick the bucket whose latest timestamp across either profile is most
 *    recent — that is the "active group".
 * 3. Within the bucket, pick the latest report per contextProfile.
 *
 * Returns `{ kind: "ok", … }` when both profiles have at least one report,
 * otherwise `{ kind: "missing", … }` with a human-readable warning so the
 * caller can fall back to the trend view instead of crashing.
 */
type ProfilePairResult =
  | {
      kind: "ok";
      typesOnly: { report: ChallengeReport; path: string };
      fullPackage: { report: ChallengeReport; path: string };
    }
  | { kind: "missing"; reason: string };

export function resolveActiveProfilePair(reports: ChallengeReport[]): ProfilePairResult {
  if (reports.length === 0) {
    return { kind: "missing", reason: "no reports found under results/" };
  }
  // Reports that ran against a non-default `--sdk-branch` are A/B experiment
  // candidate runs, not part of the main solver history. Excluding them here
  // keeps profile-diff focused on apples-to-apples comparisons.
  const mainReports = reports.filter((r) => r.sdkBranch === undefined);
  if (mainReports.length === 0) {
    return {
      kind: "missing",
      reason: "no main-line reports (every report has --sdk-branch set)",
    };
  }
  type Bucket = { typesOnly?: ChallengeReport; fullPackage?: ChallengeReport };
  const buckets = new Map<string, Bucket>();
  // Per-profile selection: prefer the report with the largest result set
  // (i.e. a full sweep over the problem list rather than a single-problem
  // rerun), tie-broken by recency. This keeps the auto-resolved diff
  // representative even when ad-hoc one-off solves are written into the
  // same results directory after a full sweep.
  function isBetter(candidate: ChallengeReport, existing: ChallengeReport | undefined): boolean {
    if (!existing) return true;
    if (candidate.results.length !== existing.results.length) {
      return candidate.results.length > existing.results.length;
    }
    return new Date(candidate.timestamp).getTime() > new Date(existing.timestamp).getTime();
  }
  for (const r of mainReports) {
    const { model } = getGroupKey(r);
    const id = model;
    const profile = r.contextProfile;
    if (profile !== "code-only" && profile !== "code-and-docs") continue;
    const bucket = buckets.get(id) ?? {};
    const slot = profile === "code-only" ? "typesOnly" : "fullPackage";
    if (isBetter(r, bucket[slot])) {
      bucket[slot] = r;
    }
    buckets.set(id, bucket);
  }
  if (buckets.size === 0) {
    return {
      kind: "missing",
      reason: "no reports with contextProfile code-only or code-and-docs",
    };
  }
  // Active group: bucket with the most-recent timestamp across either slot,
  // restricted to buckets where BOTH profiles are present. We deliberately
  // skip half-populated buckets (e.g. `solution:verify` runs that only emit
  // code-and-docs reports) so we never report "active group has X but missing
  // Y" for a group whose intent isn't even cross-profile.
  const complete: { id: string; bucket: Bucket; latest: number }[] = [];
  for (const [id, bucket] of buckets) {
    if (!bucket.typesOnly || !bucket.fullPackage) continue;
    const ts = Math.max(
      new Date(bucket.typesOnly.timestamp).getTime(),
      new Date(bucket.fullPackage.timestamp).getTime(),
    );
    complete.push({ id, bucket, latest: ts });
  }
  if (complete.length === 0) {
    // Fall back to surfacing the most-recent half-populated bucket so the
    // caller learns which side is missing — better diagnostic than a
    // generic "no complete groups" message.
    let halfActive: { id: string; bucket: Bucket; latest: number } | undefined;
    for (const [id, bucket] of buckets) {
      const ts = Math.max(
        bucket.typesOnly ? new Date(bucket.typesOnly.timestamp).getTime() : 0,
        bucket.fullPackage ? new Date(bucket.fullPackage.timestamp).getTime() : 0,
      );
      if (!halfActive || ts > halfActive.latest) {
        halfActive = { id, bucket, latest: ts };
      }
    }
    const bucket = halfActive!.bucket;
    const present = bucket.typesOnly ? "code-only" : "code-and-docs";
    const missing = bucket.typesOnly ? "code-and-docs" : "code-only";
    return {
      kind: "missing",
      reason: `active group has ${present} reports but no ${missing} reports`,
    };
  }
  complete.sort((a, b) => b.latest - a.latest);
  // `complete` is filtered to only buckets with both slots present, so the
  // non-null assertions here are safe.
  const bucket = complete[0]!.bucket;
  const typesOnly = bucket.typesOnly!;
  const fullPackage = bucket.fullPackage!;
  return {
    kind: "ok",
    typesOnly: { report: typesOnly, path: deriveReportPath(typesOnly) },
    fullPackage: { report: fullPackage, path: deriveReportPath(fullPackage) },
  };
}

/**
 * Re-derive a report's filesystem path from its in-memory contents. Used to
 * label `--profile-diff` outputs with the original `results/<group>/report-*.json`
 * paths. Returns the conventional layout used by `cli.ts:getRunResultsDir`.
 */
function deriveReportPath(report: ChallengeReport): string {
  const profile = report.contextProfile ?? "unknown";
  const baseLabel = report.model ?? "solution-verify";
  // Mirror cli.ts:getRunResultsDir so profile-diff resolves to the same path.
  const dir = sanitizeForFilename(`${baseLabel}-${profile}`);
  const version = report.sdkVersion ?? "unknown";
  const ts = report.timestamp.replace(/:/g, "-").slice(0, 19);
  return path.join("results", dir, `report-${version}-${ts}.json`);
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

/**
 * Render the per-bucket readTargets delta as a compact one-line summary.
 * Returns undefined when every bucket delta is null or zero — keeps the table
 * tight by suppressing rows whose readTargets are flat.
 *
 * Format: `read deltas: sdk-dts=+2 sdk-pkg-src=±0 sdk-docs=-1 problem-files=+0 other=±0`
 *
 * Buckets with null deltas (one side missing the data) are omitted from the
 * line entirely rather than printed as `null`.
 */
function formatReadDeltas(deltas: DiffRow["readDeltas"]): string | undefined {
  const labels: Record<ReadTargetClass, string> = {
    "sdk-dts": "sdk-dts",
    "sdk-package-src": "sdk-pkg-src",
    "sdk-docs": "sdk-docs",
    "problem-files": "problem-files",
    other: "other",
  };
  const parts: string[] = [];
  let hasNonZero = false;
  for (const bucket of READ_TARGET_CLASSES) {
    const value = deltas[bucket];
    if (value === null) continue;
    if (value !== 0) hasNonZero = true;
    parts.push(`${labels[bucket]}=${formatDelta(value, 0)}`);
  }
  if (!hasNonZero) return undefined;
  return `read deltas: ${parts.join(" ")}`;
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

  // Columns: Problem | passA | passB | Δpass | stdevA | stdevB | Δturns
  console.log(
    "Problem".padEnd(38) +
      "passA".padEnd(8) +
      "passB".padEnd(8) +
      "Δpass".padEnd(10) +
      "stdevA".padEnd(9) +
      "stdevB".padEnd(9) +
      "Δturns",
  );
  console.log("-".repeat(width));
  for (const row of diff.rows) {
    const key = row.problemKey.slice(0, 37).padEnd(38);
    const passA = formatPct(row.passRateA).padEnd(8);
    const passB = formatPct(row.passRateB).padEnd(8);
    const dpass = row.passRateDelta !== null ? formatDelta(row.passRateDelta, 2) : "  -  ";
    const stdA = row.stdevTurnsA !== null ? row.stdevTurnsA.toFixed(1) : "  -  ";
    const stdB = row.stdevTurnsB !== null ? row.stdevTurnsB.toFixed(1) : "  -  ";
    const dturns =
      row.metricsDelta.turns !== null ? formatDelta(row.metricsDelta.turns, 1) : "  -  ";
    const tag = row.status === "present" ? "" : `  [${row.status}]`;
    console.log(
      `${key}${passA}${passB}${dpass.padEnd(10)}${stdA.padEnd(9)}${stdB.padEnd(9)}${dturns}${tag}`,
    );

    // Per-bucket readTargets delta. Surfaced only when at least one bucket
    // has a non-zero delta so the table stays scannable for flat rows.
    const readLine = formatReadDeltas(row.readDeltas);
    if (readLine) {
      console.log(`  ${readLine}`);
    }
  }
  console.log("-".repeat(width));
  console.log(`Overall ΔpassRate: ${formatDelta(diff.overallPassRateDelta, 3)}`);
  console.log("");

  console.log("=".repeat(width));
}

/**
 * Run the profile-diff path: code-only vs code-and-docs for the active group.
 * Emits the diff via `showDiff`, or prints a single-line warning when one of
 * the two profiles has no reports yet.
 *
 * `showHeading` toggles the "Profile Diff" banner; the default code path
 * (which chains trend + profile-diff) sets it true so the two sections are
 * visually separated.
 */
function runProfileDiff(
  filters: Filters,
  json: boolean,
  showHeading: boolean,
  aliasMap?: Map<string, string>,
  loadOpts: { includeArchived?: boolean } = {},
): boolean {
  // contextProfile filter would exclude one of the two profiles we need to
  // diff, so we strip it here. agent/model are still honored so callers can
  // narrow to a specific solver when multiple coexist.
  const profileSafeFilters: Filters = { ...filters };
  delete profileSafeFilters.contextProfile;
  const reports = loadReports(profileSafeFilters, loadOpts);
  const pair = resolveActiveProfilePair(reports);
  if (pair.kind === "missing") {
    console.log(`(profile-diff skipped: ${pair.reason})`);
    return false;
  }
  if (showHeading) {
    const width = 110;
    console.log("");
    console.log("=".repeat(width));
    console.log("Profile Diff (code-only -> code-and-docs)");
    console.log("=".repeat(width));
  }
  const diff = computeReportDiff(
    pair.typesOnly.report,
    pair.fullPackage.report,
    { a: pair.typesOnly.path, b: pair.fullPackage.path },
    aliasMap ? { aliasMap } : {},
  );
  showDiff(diff, json);
  return true;
}

function main(): void {
  const {
    trend,
    groups,
    profileDiff,
    model,
    contextProfile,
    diffPair,
    json,
    unifyAliases,
    includeArchived,
  } = parseArgs();
  const filters: Filters = { model, contextProfile };
  const aliasMap = unifyAliases ? buildAliasMap() : undefined;
  const loadOpts = { includeArchived };

  if (diffPair) {
    const [pathA, pathB] = diffPair;
    const reportA = loadReportFile(pathA);
    const reportB = loadReportFile(pathB);
    const diff = computeReportDiff(
      reportA,
      reportB,
      { a: pathA, b: pathB },
      aliasMap ? { aliasMap } : {},
    );
    showDiff(diff, json);
    return;
  }

  if (groups) {
    const reports = loadReports(filters, loadOpts);
    if (reports.length === 0) {
      console.error(`No report groups match filters (${describeFilters(filters)}).`);
      process.exit(1);
    }
    showGroupsOverview(reports);
    return;
  }

  if (profileDiff) {
    const ok = runProfileDiff(filters, json, false, aliasMap, loadOpts);
    if (!ok) process.exit(1);
    return;
  }

  // `--context-profile` is intentionally ignored when picking trend reports
  // below if the caller is in the default path, because the default path also
  // emits a profile-diff that needs both profiles. We still respect
  // agent/model filters since those select WHICH solver to look at.
  const filtered = loadReports(filters, loadOpts);

  if (trend) {
    if (filtered.length === 0) {
      console.error(`No reports match filters (${describeFilters(filters)}).`);
      console.error("Run 'pnpm challenge:analyze --groups' to list available groups.");
      process.exit(1);
    }
    showTrend(filtered, describeFilters(filters), aliasMap);
    return;
  }

  // Default: trend within the most recently active matching group, followed
  // by a profile-diff section (when both profiles have reports). Either
  // signal alone is useful; rendering both surfaces docs-vs-types gaps next
  // to time-series progression.
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
  showTrend(sorted, formatGroupKey(chosen.key), aliasMap);

  // Then surface the profile-diff. Skipped silently when one of the two
  // contextProfiles has no reports yet.
  runProfileDiff(filters, json, true, aliasMap, loadOpts);
}

// Only auto-run when invoked directly via `tsx core/analyze.ts`, so importing
// from tests (vitest) does not kick off the analyzer.
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
