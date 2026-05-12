import { problemKey } from "../shared/helpers";
import type { ChallengeStage, ProblemMeta, ProblemSplit } from "../shared/helpers";
import { classifyAffordance, getRedesignSuggestion } from "./affordance";
import type { FailureAffordance } from "./affordance";
import type { OmissionDetail } from "./api-check";
import type { SolveResult } from "./solve";
import type { TestDetail, StageInput } from "./verify";

export type FailureCategory =
  | "missing_file"
  | "import_error"
  | "type_error"
  | "generate_error"
  | "logic_error"
  | "api_misuse"
  | "api_design"
  | "infra_failure"
  | "runner_error";

export type StageResult = {
  stage: ChallengeStage;
  passed: boolean;
  output: string;
  score: number;
  maxScore: number;
  durationMs?: number;
  category?: FailureCategory;
  /**
   * Anthropic-style affordance label: what kind of SDK redesign would most
   * likely prevent this failure. Orthogonal to `category` (the surface).
   */
  affordance?: FailureAffordance;
  testsPassed?: number;
  testsTotal?: number;
  testDetails?: TestDetail[];
  /**
   * Per-file omissions detected by the apiCheck stage's required-symbols pass.
   * Surfaces "what the agent forgot to do" as a first-class signal so analytics
   * can correlate failures with specific missing identifiers.
   */
  omissions?: OmissionDetail[];
};

export type ScaffoldChange = {
  file: string;
  original: string;
  modified: string;
};

export type ProblemArtifacts = {
  directory: string;
  finalWorkSnapshotDir?: string;
};

export type ProblemResult = {
  problemId: string;
  problemName: string;
  difficulty: string;
  category: string;
  /**
   * Held-out split label inherited from the problem's meta.json. Optional in
   * the type for backward compatibility with reports written before splits
   * existed; new results always populate it. Analytics treats a missing split
   * as `"train"`.
   */
  split?: ProblemSplit;
  contextProfile?: string;
  stages: StageResult[];
  totalScore: number;
  maxScore: number;
  firstAttemptScore?: number;
  firstAttemptStages?: StageResult[];
  adjustedScore?: number;
  solveResult?: SolveResult;
  retryCount?: number;
  retrySolveResults?: SolveResult[];
  totalDurationMs?: number;
  scaffoldChanges?: ScaffoldChange[];
  artifacts?: ProblemArtifacts;
};

export type SuccessRate = { passed: number; total: number; rate: number };

type FailurePattern = {
  pattern: string;
  count: number;
  affectedProblems: string[];
  /** Primary remediation message. For non-`docs_only` affordances this echoes `apiChange`. */
  suggestedDocFix: string;
  affordance?: FailureAffordance;
  apiChange?: string;
  docFallback?: string;
  anthropicAnalog?: string;
};

type SplitAggregate = {
  totalScore: number;
  maxScore: number;
  problemCount: number;
  percentage: number;
};

type Analytics = {
  failureDistribution: Partial<Record<FailureCategory, number>>;
  affordanceDistribution: Partial<Record<FailureAffordance, number>>;
  categorySuccessRates: Record<string, SuccessRate>;
  difficultySuccessRates: Record<string, SuccessRate>;
  stagePassRates: Record<string, SuccessRate>;
  splitAggregates: Partial<Record<ProblemSplit, SplitAggregate>>;
  /**
   * Anthropic-style overfit warning: positive when train score outpaces holdout
   * score by more than a threshold (10 percentage points). Negative or absent
   * when there is no signal (e.g. one split missing). Computed only when both
   * `train` and `holdout` splits have at least one valid problem.
   */
  overfitGap?: number;
  commonFailurePatterns: FailurePattern[];
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
  /** Total tokens (input + output + cache reads) divided by total score. Tokens-per-point. */
  tokensPerPoint?: number;
};

export type ChallengeReport = {
  timestamp: string;
  model?: string;
  contextProfile?: string;
  sdkVersion?: string;
  results: ProblemResult[];
  totalScore: number;
  maxScore: number;
  percentage: number;
  adjustedScore: number;
  adjustedPercentage: number;
  totalCostUsd: number;
  scorePerDollar?: number;
  avgCostPerPoint?: number;
  infraFailureCount: number;
  validPercentage: number;
  totalDurationMs: number;
  analytics: Analytics;
  /** Run-level token usage summary. Undefined when no adapter reported usage. */
  usageSummary?: UsageSummary;
};

function classifyFailure(stage: ChallengeStage, output: string): FailureCategory | undefined {
  // Skipped stages (due to earlier stage failure) should not be classified
  if (/^Skipped\b/.test(output)) {
    return undefined;
  }
  // Check import errors before generic TS code matching so that TS2307
  // ("Cannot find module") is classified as import_error, not type_error.
  if (/Cannot find module|does not provide an export/.test(output)) {
    return "import_error";
  }
  if (/TS\d{4}/.test(output)) {
    return "type_error";
  }
  if (/does not exist|ENOENT|required files missing/.test(output)) {
    return "missing_file";
  }
  if (stage === "generate") {
    if (/validation|invalid|schema/i.test(output)) {
      return "api_misuse";
    }
    return "generate_error";
  }
  if (stage === "apiCheck") {
    return "api_design";
  }
  if (stage === "typecheck") {
    return "type_error";
  }
  return "logic_error";
}

export function calculateScore(meta: ProblemMeta, stages: StageInput[]): StageResult[] {
  return stages.map((s) => {
    const maxScore = meta.scoring[s.stage] ?? 0;
    const category = s.passed ? undefined : classifyFailure(s.stage, s.output);
    const failedTestNames = s.testDetails?.filter((t) => t.status === "failed").map((t) => t.name);
    const affordance = s.passed
      ? undefined
      : classifyAffordance({ stage: s.stage, output: s.output, category, failedTestNames });

    // Partial scoring for stages with test counts (generate and tests stages)
    if (s.testsTotal != null && s.testsTotal > 0) {
      const testsPassed = s.testsPassed ?? 0;
      // Clamp at 0 so an unweighted (`maxScore === 0`) failing partial does not
      // produce a negative `maxScore - 1`.
      const score =
        testsPassed === s.testsTotal
          ? maxScore
          : Math.max(
              0,
              Math.min(Math.round((testsPassed / s.testsTotal) * maxScore), maxScore - 1),
            );
      return { ...s, score, maxScore, category, affordance };
    }

    return {
      ...s,
      score: s.passed ? maxScore : 0,
      maxScore,
      category,
      affordance,
    };
  });
}

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

function computeAnalytics(results: ProblemResult[]): Analytics {
  // Failure / affordance distributions
  const failureDistribution: Partial<Record<FailureCategory, number>> = {};
  const affordanceDistribution: Partial<Record<FailureAffordance, number>> = {};
  for (const r of results) {
    for (const s of r.stages) {
      if (s.passed) {
        continue;
      }
      if (s.category) {
        failureDistribution[s.category] = (failureDistribution[s.category] ?? 0) + 1;
      }
      if (s.affordance) {
        affordanceDistribution[s.affordance] = (affordanceDistribution[s.affordance] ?? 0) + 1;
      }
    }
  }

  const isPerfectScore = (r: ProblemResult): boolean => r.totalScore === r.maxScore;
  const categorySuccessRates = computeSuccessRates(results, (r) => r.category, isPerfectScore);
  const difficultySuccessRates = computeSuccessRates(results, (r) => r.difficulty, isPerfectScore);

  // Stage pass rates (exclude skipped stages from totals)
  const stageItems: { stage: string; passed: boolean }[] = [];
  for (const r of results) {
    for (const s of r.stages) {
      if (!s.output?.startsWith("Skipped")) {
        stageItems.push({ stage: s.stage, passed: s.passed });
      }
    }
  }
  const stagePassRates = computeSuccessRates(
    stageItems,
    (s) => s.stage,
    (s) => s.passed,
  );

  // Common failure patterns are now keyed on **affordance** (or category when no
  // affordance was inferred), so the report surfaces "the kind of API redesign
  // that would help" rather than just "the kind of error that appeared".
  type PatternEntry = {
    count: number;
    problems: string[];
    stage: ChallengeStage;
    category: FailureCategory;
    affordance?: FailureAffordance;
  };
  const patternCounts: Record<string, PatternEntry> = {};
  for (const r of results) {
    for (const s of r.stages) {
      if (s.passed || !s.category) {
        continue;
      }
      const affordancePart = s.affordance ?? "(unclassified)";
      const key = `${r.category}:${s.stage}:${s.category}:${affordancePart}`;
      const entry = (patternCounts[key] ??= {
        count: 0,
        problems: [],
        stage: s.stage,
        category: s.category,
        ...(s.affordance ? { affordance: s.affordance } : {}),
      });
      entry.count++;
      const label = problemKey(r.problemId, r.problemName);
      if (!entry.problems.includes(label)) {
        entry.problems.push(label);
      }
    }
  }
  const commonFailurePatterns: FailurePattern[] = [];
  for (const entry of Object.values(patternCounts)) {
    if (entry.count < 2) {
      continue;
    }
    const redesign = entry.affordance ? getRedesignSuggestion(entry.affordance) : undefined;
    const label = entry.affordance
      ? `${entry.affordance} (${entry.category}) in ${entry.stage}`
      : `${entry.category} in ${entry.stage}`;
    commonFailurePatterns.push({
      pattern: label,
      count: entry.count,
      affectedProblems: entry.problems,
      suggestedDocFix: redesign?.apiChange ?? `Document recovery for ${entry.category}`,
      ...(redesign
        ? {
            affordance: redesign.affordance,
            apiChange: redesign.apiChange,
            docFallback: redesign.docFallback,
            anthropicAnalog: redesign.anthropicAnalog,
          }
        : {}),
    });
  }
  // Highest-impact patterns first.
  commonFailurePatterns.sort((a, b) => b.count - a.count);

  // Per-split aggregates and overfit gap (train pct - holdout pct).
  // Historic reports may omit `split`; default to `"train"` so that legacy
  // reports continue to aggregate without producing a spurious "undefined"
  // bucket.
  const splitAggregates: Partial<Record<ProblemSplit, SplitAggregate>> = {};
  for (const r of results) {
    const split: ProblemSplit = r.split ?? "train";
    const agg = (splitAggregates[split] ??= {
      totalScore: 0,
      maxScore: 0,
      problemCount: 0,
      percentage: 0,
    });
    agg.totalScore += r.totalScore;
    agg.maxScore += r.maxScore;
    agg.problemCount += 1;
  }
  for (const agg of Object.values(splitAggregates)) {
    if (agg) {
      agg.percentage = agg.maxScore > 0 ? Math.round((agg.totalScore / agg.maxScore) * 100) : 0;
    }
  }
  let overfitGap: number | undefined;
  const trainAgg = splitAggregates.train;
  const holdoutAgg = splitAggregates.holdout;
  if (trainAgg && holdoutAgg && trainAgg.problemCount > 0 && holdoutAgg.problemCount > 0) {
    overfitGap = trainAgg.percentage - holdoutAgg.percentage;
  }

  return {
    failureDistribution,
    affordanceDistribution,
    categorySuccessRates,
    difficultySuccessRates,
    stagePassRates,
    splitAggregates,
    ...(overfitGap !== undefined ? { overfitGap } : {}),
    commonFailurePatterns,
  };
}

export function isInfraFailure(result: ProblemResult): boolean {
  return result.stages.length > 0 && result.stages.every((s) => s.category === "infra_failure");
}

function computeProblemCost(result: ProblemResult): number {
  let cost = result.solveResult?.costUsd ?? 0;
  if (result.retrySolveResults) {
    cost += result.retrySolveResults.reduce((s, rs) => s + rs.costUsd, 0);
  }
  return cost;
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

function summarizeUsage(results: ProblemResult[], totalScore: number): UsageSummary | undefined {
  const acc: UsageSummary = {};
  for (const r of results) {
    addUsage(acc, r.solveResult?.usage);
    if (r.retrySolveResults) {
      for (const retry of r.retrySolveResults) {
        addUsage(acc, retry.usage);
      }
    }
  }
  if (Object.keys(acc).length === 0) {
    return undefined;
  }
  const totalTokens = (acc.inputTokens ?? 0) + (acc.outputTokens ?? 0) + (acc.cacheReadTokens ?? 0);
  if (totalTokens > 0 && totalScore > 0) {
    acc.tokensPerPoint = Math.round(totalTokens / totalScore);
  }
  return acc;
}

/**
 * Compute adjusted score with retry penalty.
 * Formula: base_score * (1 - 0.1 * retry_count), max 30% reduction.
 */
export function computeAdjustedScore(result: ProblemResult): number {
  const retryCount = result.retryCount ?? 0;
  if (retryCount === 0) {
    return result.totalScore;
  }
  const penalty = Math.min(0.1 * retryCount, 0.3);
  return Math.round(result.totalScore * (1 - penalty));
}

export function createReport(
  results: ProblemResult[],
  metadata?: { model?: string; contextProfile?: string; sdkVersion?: string; elapsedMs?: number },
): ChallengeReport {
  const infraFailureCount = results.filter(isInfraFailure).length;
  const validResults = results.filter((r) => !isInfraFailure(r));

  const totalScore = results.reduce((sum, r) => sum + r.totalScore, 0);
  const maxScore = results.reduce((sum, r) => sum + r.maxScore, 0);

  // Adjusted score with retry penalty
  const adjustedScore = results.reduce((sum, r) => sum + (r.adjustedScore ?? r.totalScore), 0);

  // Exclude infra failures from cost calculation
  const totalCostUsd = validResults.reduce((sum, r) => sum + computeProblemCost(r), 0);

  // Valid-only scoring (excluding infra failures)
  const validScore = validResults.reduce((sum, r) => sum + r.totalScore, 0);
  const validMaxScore = validResults.reduce((sum, r) => sum + r.maxScore, 0);
  const validPercentage = validMaxScore > 0 ? Math.round((validScore / validMaxScore) * 100) : 0;

  // Cost efficiency (based on valid results only)
  const scorePerDollar = totalCostUsd > 0 ? validScore / totalCostUsd : undefined;
  const avgCostPerPoint =
    totalCostUsd > 0 && validScore > 0 ? totalCostUsd / validScore : undefined;

  // Total duration: prefer wall-clock elapsed time (accurate for parallel runs)
  const totalDurationMs =
    metadata?.elapsedMs ?? results.reduce((sum, r) => sum + (r.totalDurationMs ?? 0), 0);

  const analytics = computeAnalytics(validResults);
  const usageSummary = summarizeUsage(validResults, validScore);

  return {
    timestamp: new Date().toISOString(),
    model: metadata?.model,
    contextProfile: metadata?.contextProfile,
    sdkVersion: metadata?.sdkVersion,
    results,
    totalScore,
    maxScore,
    percentage: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0,
    adjustedScore,
    adjustedPercentage: maxScore > 0 ? Math.round((adjustedScore / maxScore) * 100) : 0,
    totalCostUsd,
    scorePerDollar,
    avgCostPerPoint,
    infraFailureCount,
    validPercentage,
    totalDurationMs,
    analytics,
    ...(usageSummary ? { usageSummary } : {}),
  };
}

export function formatReportTable(report: ChallengeReport): string {
  const hasCost = report.results.some((r) => r.solveResult !== undefined);
  const hasRetries = report.results.some((r) => (r.retryCount ?? 0) > 0);
  const width = hasCost ? 102 : 90;

  const lines: string[] = [];
  lines.push("=".repeat(width));
  lines.push("Challenge Results");
  lines.push("=".repeat(width));
  lines.push("");

  let header =
    "Problem".padEnd(30) + "Difficulty".padEnd(12) + "Score".padEnd(15) + "Status".padEnd(10);
  if (hasRetries) {
    header += "1st".padEnd(8);
  }
  if (hasCost) {
    header += "Cost";
  }
  lines.push(header);
  lines.push("-".repeat(width));

  for (const r of report.results) {
    const infraFailed = isInfraFailure(r);
    const nameRaw = problemKey(r.problemId, r.problemName);
    const name = (nameRaw.length > 29 ? `${nameRaw.slice(0, 28)}\u2026` : nameRaw).padEnd(30);
    const diff = r.difficulty.padEnd(12);
    const score = (infraFailed ? "-" : `${r.totalScore}/${r.maxScore}`).padEnd(15);
    let statusLabel = "PARTIAL";
    if (infraFailed) {
      statusLabel = "INFRA";
    } else if (r.totalScore === r.maxScore) {
      statusLabel = "PASS";
    }
    const status = statusLabel.padEnd(10);
    let line = `${name}${diff}${score}${status}`;
    if (hasRetries) {
      const firstAttempt =
        !infraFailed && r.firstAttemptScore != null ? `${r.firstAttemptScore}` : "";
      line += firstAttempt.padEnd(8);
    }
    if (hasCost && r.solveResult && !infraFailed) {
      line += `$${computeProblemCost(r).toFixed(4)}`;
    }
    lines.push(line);

    if (!infraFailed) {
      for (const s of r.stages) {
        const stageName = `  ${s.stage}`.padEnd(30);
        const stageScore = `${s.score}/${s.maxScore}`.padEnd(15);
        let stageStatus = "FAIL";
        if (s.passed) {
          stageStatus = "ok";
        } else if (s.score > 0) {
          stageStatus = "PARTIAL";
        }
        const categoryLabel = s.category ? ` [${s.category}]` : "";
        const affordanceLabel = s.affordance ? ` <${s.affordance}>` : "";
        const testCountLabel =
          s.testsTotal != null ? ` (${s.testsPassed ?? 0}/${s.testsTotal} tests)` : "";
        const durationLabel = s.durationMs != null ? ` ${(s.durationMs / 1000).toFixed(1)}s` : "";
        lines.push(
          `${stageName}${"".padEnd(12)}${stageScore}${stageStatus}${categoryLabel}${affordanceLabel}${testCountLabel}${durationLabel}`,
        );
        if (s.omissions && s.omissions.length > 0) {
          for (const omission of s.omissions) {
            lines.push(`      omitted in ${omission.file}: ${omission.missingSymbols.join(", ")}`);
          }
        }
      }
    }
  }

  lines.push("-".repeat(width));
  let totalLine = `${"Total".padEnd(30)}${"".padEnd(12)}${`${report.totalScore}/${report.maxScore}`.padEnd(15)}${`${report.percentage}%`.padEnd(10)}`;
  if (hasCost) {
    totalLine += `$${report.totalCostUsd.toFixed(4)}`;
  }
  lines.push(totalLine);

  // Adjusted score (with retry penalty)
  if (hasRetries && report.adjustedScore !== report.totalScore) {
    lines.push(
      `${"Adjusted (retry penalty)".padEnd(30)}${"".padEnd(12)}${`${report.adjustedScore}/${report.maxScore}`.padEnd(15)}${`${report.adjustedPercentage}%`}`,
    );
  }

  // Valid score (excluding infra failures)
  if (report.infraFailureCount > 0) {
    lines.push(
      `${"Valid (excl. infra)".padEnd(30)}${"".padEnd(12)}${`${report.results.length - report.infraFailureCount}/${report.results.length} problems`.padEnd(15)}${`${report.validPercentage}%`}`,
    );
  }

  // Cost efficiency
  if (report.scorePerDollar != null) {
    lines.push("");
    lines.push(
      `Cost efficiency: ${report.scorePerDollar.toFixed(1)} pts/$  |  $${report.avgCostPerPoint?.toFixed(4)}/pt`,
    );
  }

  // Token usage (Anthropic-style context-bloat sensor).
  if (report.usageSummary) {
    const u = report.usageSummary;
    const parts: string[] = [];
    if (u.inputTokens !== undefined) parts.push(`input=${u.inputTokens.toLocaleString()}`);
    if (u.outputTokens !== undefined) parts.push(`output=${u.outputTokens.toLocaleString()}`);
    if (u.cacheReadTokens !== undefined)
      parts.push(`cacheRead=${u.cacheReadTokens.toLocaleString()}`);
    if (u.numTurns !== undefined) parts.push(`turns=${u.numTurns}`);
    if (u.tokensPerPoint !== undefined)
      parts.push(`tokens/pt=${u.tokensPerPoint.toLocaleString()}`);
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
      `⚠ ${report.infraFailureCount} problem(s) skipped due to infrastructure failures (auth/network/rate-limit)`,
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
  if (validResults.length > 0 && validResults.every((r) => r.totalScore === r.maxScore)) {
    lines.push("");
    lines.push(
      "WARNING: All problems passed — consider increasing difficulty or adding harder problems",
    );
  }

  lines.push("=".repeat(width));

  // Analytics summary
  const { analytics } = report;

  function appendRateSection(title: string, rates: Record<string, SuccessRate>): void {
    const entries = Object.entries(rates);
    if (entries.length === 0) {
      return;
    }
    lines.push("");
    lines.push(title);
    for (const [key, rate] of entries) {
      lines.push(`  ${key.padEnd(25)} ${rate.passed}/${rate.total} (${rate.rate}%)`);
    }
  }

  appendRateSection("Category Success Rates:", analytics.categorySuccessRates);
  appendRateSection("Difficulty Success Rates:", analytics.difficultySuccessRates);
  appendRateSection("Stage Pass Rates:", analytics.stagePassRates);

  // Affordance distribution: which kinds of SDK redesign would most likely help.
  const affordanceEntries = Object.entries(analytics.affordanceDistribution);
  if (affordanceEntries.length > 0) {
    lines.push("");
    lines.push("Affordance Distribution (kind of SDK redesign that would help):");
    const sortedAffordances = affordanceEntries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
    for (const [affordance, count] of sortedAffordances) {
      lines.push(`  ${affordance.padEnd(28)} ${count}`);
    }
  }

  // Per-split aggregates and Anthropic-style overfit gap warning.
  const splitEntries = Object.entries(analytics.splitAggregates);
  if (splitEntries.length > 0) {
    lines.push("");
    lines.push("Per-Split Scores:");
    const splitOrder: ProblemSplit[] = ["train", "holdout", "regression"];
    const ordered = splitEntries.sort(
      ([a], [b]) => splitOrder.indexOf(a as ProblemSplit) - splitOrder.indexOf(b as ProblemSplit),
    );
    for (const [split, agg] of ordered) {
      if (!agg) continue;
      lines.push(
        `  ${split.padEnd(12)} ${agg.totalScore}/${agg.maxScore} (${agg.percentage}%) over ${agg.problemCount} problem(s)`,
      );
    }
    if (analytics.overfitGap !== undefined) {
      const sign = analytics.overfitGap > 0 ? "+" : "";
      const warning = analytics.overfitGap > 10 ? " (WARNING: possible overfit to train)" : "";
      lines.push(`  overfit gap   train - holdout = ${sign}${analytics.overfitGap}%${warning}`);
    }
  }

  // Common failure patterns rendered with their API-redesign suggestion.
  if (analytics.commonFailurePatterns.length > 0) {
    lines.push("");
    lines.push("Suggested API Redesigns (from repeated failure patterns):");
    for (const p of analytics.commonFailurePatterns) {
      lines.push(`  ${p.pattern} (${p.count}x)`);
      if (p.apiChange) {
        lines.push(`    API:   ${p.apiChange}`);
      }
      if (p.docFallback) {
        lines.push(`    Docs:  ${p.docFallback}`);
      }
      if (p.anthropicAnalog && p.anthropicAnalog !== "—") {
        lines.push(`    Cf.:   ${p.anthropicAnalog}`);
      }
      if (!p.apiChange) {
        lines.push(`    -> ${p.suggestedDocFix}`);
      }
    }
  }

  return lines.join("\n");
}
