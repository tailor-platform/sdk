import fs from "node:fs";
import path from "node:path";
import { problemKey, requireArg } from "../shared/helpers";
import { computeSuccessRates, isInfraFailure } from "./score";
import type { ChallengeReport, FailureCategory, SuccessRate } from "./score";

const challengeRoot = path.resolve(import.meta.dirname, "..");

type Filters = {
  agent?: string;
  model?: string;
  contextProfile?: string;
};

type ParsedArgs = Filters & {
  baseline?: string;
  trend: boolean;
  groups: boolean;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let baseline: string | undefined;
  let trend = false;
  let groups = false;
  let agent: string | undefined;
  let model: string | undefined;
  let contextProfile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--baseline":
        baseline = requireArg(args, i, "--baseline");
        i++;
        break;
      case "--trend":
        trend = true;
        break;
      case "--groups":
        groups = true;
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

  return { baseline, trend, groups, agent, model, contextProfile };
}

type GroupKey = {
  agent: string;
  model: string;
  contextProfile: string;
};

function getGroupKey(report: ChallengeReport): GroupKey {
  // model field is "agent:model" (e.g. "claude:opus"), null/undefined/"" for solution-verify.
  // Composite labels like "claude:opus+codex:default" reduce to the primary segment.
  const raw = report.model || "solution:verify";
  const primary = raw.split("+")[0] ?? raw;
  const colonIndex = primary.indexOf(":");
  const agent = colonIndex === -1 ? primary : primary.slice(0, colonIndex);
  const model = colonIndex === -1 ? "default" : primary.slice(colonIndex + 1);
  return {
    agent: agent || "unknown",
    model: model || "default",
    contextProfile: report.contextProfile || "unknown",
  };
}

function formatGroupKey(key: GroupKey): string {
  return `${key.agent}:${key.model} / ${key.contextProfile}`;
}

function groupKeyId(key: GroupKey): string {
  return `${key.agent}|${key.model}|${key.contextProfile}`;
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

function loadReport(filePath: string): ChallengeReport {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`Report file not found: ${resolved}`);
    process.exit(1);
  }
  const content = fs.readFileSync(resolved, "utf-8");
  return JSON.parse(content) as ChallengeReport;
}

function formatDelta(delta: number, suffix = ""): string {
  if (delta > 0) return `+${delta}${suffix}`;
  if (delta < 0) return `${delta}${suffix}`;
  return "=";
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function getFailureCategory(
  result: ChallengeReport["results"][number],
): FailureCategory | undefined {
  for (const s of result.stages) {
    if (!s.passed && s.category) {
      return s.category;
    }
  }
  return undefined;
}

type SuccessRateMap = Record<string, SuccessRate>;

function computeRatesFromReport(
  report: ChallengeReport,
  cached: SuccessRateMap | undefined,
  groupKeyFn: (r: ChallengeReport["results"][number]) => string,
): SuccessRateMap {
  if (cached) {
    return cached;
  }
  const validResults = report.results.filter((r) => !isInfraFailure(r));
  return computeSuccessRates(validResults, groupKeyFn, (r) => r.totalScore === r.maxScore);
}

function computeCategoryRates(report: ChallengeReport): SuccessRateMap {
  return computeRatesFromReport(report, report.analytics?.categorySuccessRates, (r) => r.category);
}

function computeDifficultyRates(report: ChallengeReport): SuccessRateMap {
  return computeRatesFromReport(
    report,
    report.analytics?.difficultySuccessRates,
    (r) => r.difficulty,
  );
}

function printRateComparison(
  title: string,
  beforeRates: SuccessRateMap,
  afterRates: SuccessRateMap,
): void {
  const allKeys = [...new Set([...Object.keys(beforeRates), ...Object.keys(afterRates)])].sort();
  if (allKeys.length === 0) {
    return;
  }
  console.log(title);
  for (const key of allKeys) {
    const bEntry = beforeRates[key];
    const aEntry = afterRates[key];
    const bLabel = bEntry != null ? `${bEntry.rate}%` : "N/A";
    const aLabel = aEntry != null ? `${aEntry.rate}%` : "N/A";
    const delta =
      bEntry != null && aEntry != null ? ` (${formatDelta(aEntry.rate - bEntry.rate, "%")})` : "";
    console.log(`  ${key}: ${bLabel} -> ${aLabel}${delta}`);
  }
  console.log("");
}

function showComparison(before: ChallengeReport, after: ChallengeReport): void {
  const width = 80;
  console.log("=".repeat(width));
  console.log("Report Comparison");
  console.log("=".repeat(width));
  console.log("");
  console.log(`  Group: ${formatGroupKey(getGroupKey(after))}`);
  console.log(
    `  Before: ${formatTimestamp(before.timestamp)}${before.model ? ` (${before.model})` : ""}`,
  );
  console.log(
    `  After:  ${formatTimestamp(after.timestamp)}${after.model ? ` (${after.model})` : ""}`,
  );
  console.log("");

  // Build lookup maps
  const beforeMap = new Map(before.results.map((r) => [problemKey(r.problemId, r.problemName), r]));
  const afterMap = new Map(after.results.map((r) => [problemKey(r.problemId, r.problemName), r]));

  // Collect all problem keys in order
  const allKeys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();

  // Per-problem comparison table
  const header =
    "Problem".padEnd(30) + "Before".padEnd(12) + "After".padEnd(12) + "Delta".padEnd(8) + "Notes";
  console.log(header);
  console.log("-".repeat(width));

  for (const key of allKeys) {
    const b = beforeMap.get(key);
    const a = afterMap.get(key);

    const beforeScore = b ? `${b.totalScore}/${b.maxScore}` : "-";
    const afterScore = a ? `${a.totalScore}/${a.maxScore}` : "-";

    const bTotal = b?.totalScore ?? 0;
    const aTotal = a?.totalScore ?? 0;
    const delta = aTotal - bTotal;
    let deltaStr = "new";
    if (b && a) {
      deltaStr = formatDelta(delta);
    } else if (b) {
      deltaStr = "removed";
    }

    // Failure category change
    const bCat = b ? getFailureCategory(b) : undefined;
    const aCat = a ? getFailureCategory(a) : undefined;
    let notes = "";
    if (bCat && aCat && bCat !== aCat) {
      notes = `[${bCat} -> ${aCat}]`;
    } else if (bCat && !aCat && a && a.totalScore === a.maxScore) {
      notes = `[${bCat} -> passed]`;
    } else if (!bCat && aCat) {
      notes = `[-> ${aCat}]`;
    } else if (bCat && aCat && bCat === aCat && delta === 0) {
      notes = `[persistent: ${aCat}]`;
    }

    console.log(
      `${key.slice(0, 29).padEnd(30)}${beforeScore.padEnd(12)}${afterScore.padEnd(12)}${deltaStr.padEnd(8)}${notes}`,
    );
  }

  console.log("-".repeat(width));

  // Total
  const totalDelta = (after.totalScore ?? 0) - (before.totalScore ?? 0);
  console.log(
    `${"Total".padEnd(30)}${`${before.totalScore}/${before.maxScore}`.padEnd(12)}${`${after.totalScore}/${after.maxScore}`.padEnd(12)}${formatDelta(totalDelta).padEnd(8)}${before.percentage}% -> ${after.percentage}%`,
  );

  // Adjusted score comparison (if retries were used)
  if (before.adjustedScore != null || after.adjustedScore != null) {
    const adjBefore = before.adjustedScore ?? before.totalScore;
    const adjAfter = after.adjustedScore ?? after.totalScore;
    const adjDelta = adjAfter - adjBefore;
    const adjPctBefore = before.adjustedPercentage ?? before.percentage;
    const adjPctAfter = after.adjustedPercentage ?? after.percentage;
    console.log(
      `${"Adjusted".padEnd(30)}${`${adjBefore}/${before.maxScore}`.padEnd(12)}${`${adjAfter}/${after.maxScore}`.padEnd(12)}${formatDelta(adjDelta).padEnd(8)}${adjPctBefore}% -> ${adjPctAfter}%`,
    );
  }

  console.log("");

  printRateComparison(
    "Category Success Rates:",
    computeCategoryRates(before),
    computeCategoryRates(after),
  );
  printRateComparison(
    "Difficulty Success Rates:",
    computeDifficultyRates(before),
    computeDifficultyRates(after),
  );

  // Failure distribution changes (if analytics available)
  if (before.analytics?.failureDistribution || after.analytics?.failureDistribution) {
    const bDist = before.analytics?.failureDistribution ?? {};
    const aDist = after.analytics?.failureDistribution ?? {};
    const allFailCats = [...new Set([...Object.keys(bDist), ...Object.keys(aDist)])].sort();

    if (allFailCats.length > 0) {
      console.log("Failure Distribution:");
      for (const cat of allFailCats) {
        const bCount = bDist[cat as keyof typeof bDist] ?? 0;
        const aCount = aDist[cat as keyof typeof aDist] ?? 0;
        const delta = aCount - bCount;
        console.log(`  ${cat}: ${bCount} -> ${aCount} (${formatDelta(delta)})`);
      }
      console.log("");
    }
  }

  console.log("=".repeat(width));
}

function showTrend(reports: ChallengeReport[], groupLabel: string): void {
  const width = 80;
  console.log("=".repeat(width));
  console.log(`Score Trend — ${groupLabel}`);
  console.log("=".repeat(width));
  console.log("");

  // Header
  const hasAdjusted = reports.some(
    (r) => r.adjustedScore != null && r.adjustedScore !== r.totalScore,
  );
  let header = "Timestamp".padEnd(22) + "Model".padEnd(12) + "Score".padEnd(15) + "Pct".padEnd(8);
  if (hasAdjusted) {
    header += "Adj%".padEnd(8);
  }
  header += "Cost".padEnd(12) + "Pts/$";
  console.log(header);
  console.log("-".repeat(width));

  for (const r of reports) {
    const ts = formatTimestamp(r.timestamp);
    const model = (r.model ?? "-").slice(0, 11).padEnd(12);
    const score = `${r.totalScore}/${r.maxScore}`.padEnd(15);
    const pct = `${r.percentage}%`.padEnd(8);
    let line = `${ts}  ${model}${score}${pct}`;
    if (hasAdjusted) {
      const adjPct = r.adjustedPercentage != null ? `${r.adjustedPercentage}%` : "-";
      line += adjPct.padEnd(8);
    }
    const cost = r.totalCostUsd > 0 ? `$${r.totalCostUsd.toFixed(4)}` : "-";
    line += cost.padEnd(12);
    const ptsPerDollar = r.scorePerDollar != null ? `${r.scorePerDollar.toFixed(1)}` : "-";
    line += ptsPerDollar;
    console.log(line);
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
    const probHeader =
      "Problem".padEnd(30) + reports.map((_, i) => `R${i + 1}`.padEnd(10)).join("");
    console.log(probHeader);
    console.log("-".repeat(30 + reports.length * 10));

    for (const key of allProblemKeys) {
      let line = key.slice(0, 29).padEnd(30);
      for (const report of reports) {
        const result = report.results.find((r) => problemKey(r.problemId, r.problemName) === key);
        const cell = result ? `${result.totalScore}/${result.maxScore}` : "-";
        line += cell.padEnd(10);
      }
      console.log(line);
    }
    console.log("");
  }

  console.log("=".repeat(width));
}

function showGroupsOverview(reports: ChallengeReport[]): void {
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

  const width = 80;
  console.log("=".repeat(width));
  console.log("Report Groups");
  console.log("=".repeat(width));
  console.log("");
  console.log("Group".padEnd(50) + "Reports".padEnd(10) + "Latest".padEnd(22) + "Latest score");
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
    const score = `${latest.totalScore}/${latest.maxScore} (${latest.percentage}%)`;
    console.log(`${label}${count}${ts}${score}`);
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

function main(): void {
  const { baseline, trend, groups, agent, model, contextProfile } = parseArgs();
  const filters: Filters = { agent, model, contextProfile };

  if (groups) {
    const reports = loadReports();
    showGroupsOverview(reports);
    return;
  }

  if (baseline) {
    const baselineReport = loadReport(baseline);
    const reports = loadReports(filters);
    const latest = reports[reports.length - 1];
    if (!latest) {
      console.error(`No reports match filters (${describeFilters(filters)}).`);
      process.exit(1);
    }
    showComparison(baselineReport, latest);
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

  // Default: compare last 2 reports within a single group.
  // If filters narrow to one group, use that. Otherwise pick the most recently active group.
  const groupsMap = new Map<string, { key: GroupKey; reports: ChallengeReport[] }>();
  for (const r of filtered) {
    const key = getGroupKey(r);
    const id = groupKeyId(key);
    const existing = groupsMap.get(id);
    if (existing) {
      existing.reports.push(r);
    } else {
      groupsMap.set(id, { key, reports: [r] });
    }
  }

  const eligible = [...groupsMap.values()].filter((g) => g.reports.length >= 2);
  if (eligible.length === 0) {
    console.error(
      `No (agent, model, context-profile) group has >= 2 reports matching filters (${describeFilters(filters)}).`,
    );
    console.error("Run 'pnpm challenge:analyze --groups' to see what's available.");
    console.error(
      "Use --baseline <file> to compare against a specific report, or --trend to see single-run history.",
    );
    process.exit(1);
  }

  // Pick group with most recent activity (last report timestamp)
  eligible.sort((a, b) => {
    const ta = new Date(a.reports[a.reports.length - 1]!.timestamp).getTime();
    const tb = new Date(b.reports[b.reports.length - 1]!.timestamp).getTime();
    return tb - ta;
  });
  const chosen = eligible[0]!;
  const sorted = [...chosen.reports].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const before = sorted[sorted.length - 2]!;
  const after = sorted[sorted.length - 1]!;
  showComparison(before, after);
}

main();
