import { problemKey } from "../shared/helpers";
import type { ChallengeStage, ProblemMeta } from "../shared/helpers";
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
  testsPassed?: number;
  testsTotal?: number;
  testDetails?: TestDetail[];
};

export type ScaffoldChange = {
  file: string;
  original: string;
  modified: string;
};

export type ProblemResult = {
  problemId: string;
  problemName: string;
  difficulty: string;
  category: string;
  apiSurfaces?: string[];
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
};

export type SuccessRate = { passed: number; total: number; rate: number };

type FailurePattern = {
  pattern: string;
  count: number;
  affectedProblems: string[];
  suggestedDocFix: string;
};

type RetryAnalysis = {
  selfCorrectedCategories: Partial<Record<FailureCategory, number>>;
  persistentCategories: Partial<Record<FailureCategory, number>>;
};

type Analytics = {
  failureDistribution: Partial<Record<FailureCategory, number>>;
  categorySuccessRates: Record<string, SuccessRate>;
  difficultySuccessRates: Record<string, SuccessRate>;
  apiSurfaceSuccessRates: Record<string, SuccessRate>;
  contextProfileSuccessRates: Record<string, SuccessRate>;
  stagePassRates: Record<string, SuccessRate>;
  commonFailurePatterns: FailurePattern[];
  retryAnalysis?: RetryAnalysis;
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
  weightedScore: number;
  weightedMaxScore: number;
  weightedPercentage: number;
  totalCostUsd: number;
  scorePerDollar?: number;
  avgCostPerPoint?: number;
  infraFailureCount: number;
  validPercentage: number;
  totalDurationMs: number;
  analytics: Analytics;
};

const difficultyWeights: Record<string, number> = {
  easy: 1.0,
  medium: 1.5,
  hard: 2.5,
};

const failureDocSuggestions: Record<string, Record<FailureCategory, string>> = {
  generate: {
    missing_file: "Add file scaffolding examples to getting-started guide",
    import_error: "Clarify SDK import paths in CLAUDE.md and package docs",
    type_error: "Add type annotation examples for SDK configuration objects",
    generate_error: "Improve code generation error messages with fix suggestions",
    logic_error: "Add more configuration pattern examples",
    api_misuse: "Improve SDK API validation messages with expected format hints",
    api_design: "Make SDK entrypoints and public exports easier to discover from types",
    infra_failure: "Infrastructure failure - not an SDK issue",
    runner_error: "Runner error - investigate runner bug or problem setup",
  },
  apiCheck: {
    missing_file: "Add file structure documentation",
    import_error: "Document SDK import paths and public entrypoints",
    type_error: "Add type-level guidance for SDK entrypoints",
    generate_error: "Runner error - apiCheck should not classify generate errors",
    logic_error: "Add examples for the expected API usage shape",
    api_misuse: "Improve SDK API usage examples",
    api_design: "Make SDK entrypoints and public exports easier to discover from types",
    infra_failure: "Infrastructure failure - not an SDK issue",
    runner_error: "Runner error - investigate runner bug or problem setup",
  },
  typecheck: {
    missing_file: "Add file creation checklist to problem scaffold",
    import_error: "Document all SDK export paths and re-exports",
    type_error: "Add JSDoc with @example to SDK types (especially generics)",
    generate_error: "Ensure generated types include all required fields",
    logic_error: "Add type usage patterns for complex SDK APIs",
    api_misuse: "Add type-level validation with better error messages",
    api_design: "Make SDK types guide users toward the correct API shape",
    infra_failure: "Infrastructure failure - not an SDK issue",
    runner_error: "Runner error - investigate runner bug or problem setup",
  },
  tests: {
    missing_file: "Add file structure documentation",
    import_error: "Document module resolution for generated files",
    type_error: "Add runtime type checking examples",
    generate_error: "Improve generated code correctness",
    logic_error: "Add more logic examples (resolver body, executor handler, workflow jobs)",
    api_misuse: "Add API usage examples with edge cases and error handling",
    api_design: "Make runtime object shapes more consistent with SDK examples",
    infra_failure: "Infrastructure failure - not an SDK issue",
    runner_error: "Runner error - investigate runner bug or problem setup",
  },
};

function getSuggestedDocFix(stage: string, category: FailureCategory): string {
  return (
    failureDocSuggestions[stage]?.[category] ?? `Improve ${category} documentation for ${stage}`
  );
}

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
      return { ...s, score, maxScore, category };
    }

    return {
      ...s,
      score: s.passed ? maxScore : 0,
      maxScore,
      category,
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
  // Failure distribution
  const failureDistribution: Partial<Record<FailureCategory, number>> = {};
  for (const r of results) {
    for (const s of r.stages) {
      if (!s.passed && s.category) {
        failureDistribution[s.category] = (failureDistribution[s.category] ?? 0) + 1;
      }
    }
  }

  const isPerfectScore = (r: ProblemResult): boolean => r.totalScore === r.maxScore;
  const categorySuccessRates = computeSuccessRates(results, (r) => r.category, isPerfectScore);
  const difficultySuccessRates = computeSuccessRates(results, (r) => r.difficulty, isPerfectScore);
  const apiSurfaceItems = results.flatMap((r) =>
    (r.apiSurfaces ?? []).map((surface) => ({ result: r, surface })),
  );
  const apiSurfaceSuccessRates = computeSuccessRates(
    apiSurfaceItems,
    (item) => item.surface,
    (item) => isPerfectScore(item.result),
  );
  const contextProfileSuccessRates = computeSuccessRates(
    results,
    (r) => r.contextProfile ?? "unspecified",
    isPerfectScore,
  );

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

  // Common failure patterns: same FailureCategory+stage appears 2+ times in same problem category
  const patternCounts: Record<string, { count: number; problems: string[]; stage: string }> = {};
  for (const r of results) {
    for (const s of r.stages) {
      if (!s.passed && s.category) {
        const key = `${r.category}:${s.stage}:${s.category}`;
        const entry = (patternCounts[key] ??= { count: 0, problems: [], stage: s.stage });
        entry.count++;
        const label = problemKey(r.problemId, r.problemName);
        if (!entry.problems.includes(label)) {
          entry.problems.push(label);
        }
      }
    }
  }
  const commonFailurePatterns: FailurePattern[] = [];
  for (const [key, entry] of Object.entries(patternCounts)) {
    if (entry.count >= 2) {
      const [category, , failureCategory] = key.split(":") as [string, string, FailureCategory];
      commonFailurePatterns.push({
        pattern: `${failureCategory} in ${entry.stage} stage of ${category} problems`,
        count: entry.count,
        affectedProblems: entry.problems,
        suggestedDocFix: getSuggestedDocFix(entry.stage, failureCategory),
      });
    }
  }

  // Retry analysis
  let retryAnalysis: RetryAnalysis | undefined;
  const hasRetries = results.some((r) => r.retrySolveResults && r.retrySolveResults.length > 0);
  if (hasRetries) {
    const selfCorrected: Partial<Record<FailureCategory, number>> = {};
    const persistent: Partial<Record<FailureCategory, number>> = {};

    for (const r of results) {
      if (!r.retrySolveResults || r.retrySolveResults.length === 0) {
        continue;
      }
      // Skip infra-only retries: when retryCount is 0 or firstAttemptStages is absent,
      // all retries were infra failures and should not affect retry analytics
      if ((r.retryCount ?? 0) === 0 || !r.firstAttemptStages) {
        continue;
      }
      const failedCategories = (stages: StageResult[]): Set<FailureCategory> =>
        new Set(stages.filter((s) => !s.passed && s.category).map((s) => s.category!));
      const preRetryCategories = failedCategories(r.firstAttemptStages ?? r.stages);
      const postRetryCategories = failedCategories(r.stages);
      for (const cat of preRetryCategories) {
        if (postRetryCategories.has(cat)) {
          persistent[cat] = (persistent[cat] ?? 0) + 1;
        } else {
          selfCorrected[cat] = (selfCorrected[cat] ?? 0) + 1;
        }
      }
    }

    retryAnalysis = { selfCorrectedCategories: selfCorrected, persistentCategories: persistent };
  }

  return {
    failureDistribution,
    categorySuccessRates,
    difficultySuccessRates,
    apiSurfaceSuccessRates,
    contextProfileSuccessRates,
    stagePassRates,
    commonFailurePatterns,
    retryAnalysis,
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

  // Weighted scoring
  let weightedScore = 0;
  let weightedMaxScore = 0;
  for (const r of results) {
    const weight = difficultyWeights[r.difficulty] ?? 1.0;
    weightedScore += r.totalScore * weight;
    weightedMaxScore += r.maxScore * weight;
  }

  // Cost efficiency (based on valid results only)
  const scorePerDollar = totalCostUsd > 0 ? validScore / totalCostUsd : undefined;
  const avgCostPerPoint =
    totalCostUsd > 0 && validScore > 0 ? totalCostUsd / validScore : undefined;

  // Total duration: prefer wall-clock elapsed time (accurate for parallel runs)
  const totalDurationMs =
    metadata?.elapsedMs ?? results.reduce((sum, r) => sum + (r.totalDurationMs ?? 0), 0);

  const analytics = computeAnalytics(validResults);

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
    weightedScore: Math.round(weightedScore * 10) / 10,
    weightedMaxScore: Math.round(weightedMaxScore * 10) / 10,
    weightedPercentage:
      weightedMaxScore > 0 ? Math.round((weightedScore / weightedMaxScore) * 100) : 0,
    totalCostUsd,
    scorePerDollar,
    avgCostPerPoint,
    infraFailureCount,
    validPercentage,
    totalDurationMs,
    analytics,
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
        const testCountLabel =
          s.testsTotal != null ? ` (${s.testsPassed ?? 0}/${s.testsTotal} tests)` : "";
        const durationLabel = s.durationMs != null ? ` ${(s.durationMs / 1000).toFixed(1)}s` : "";
        lines.push(
          `${stageName}${"".padEnd(12)}${stageScore}${stageStatus}${categoryLabel}${testCountLabel}${durationLabel}`,
        );
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

  // Weighted score
  lines.push(
    `${"Weighted".padEnd(30)}${"".padEnd(12)}${`${report.weightedScore}/${report.weightedMaxScore}`.padEnd(15)}${`${report.weightedPercentage}%`}`,
  );

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

  // Common failure patterns
  if (analytics.commonFailurePatterns.length > 0) {
    lines.push("");
    lines.push("Common Failure Patterns:");
    for (const p of analytics.commonFailurePatterns) {
      lines.push(`  ${p.pattern} (${p.count}x) -> ${p.suggestedDocFix}`);
    }
  }

  return lines.join("\n");
}
