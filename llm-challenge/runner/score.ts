import { problemKey } from "../shared/helpers";
import type { ProblemMeta } from "../shared/helpers";
import type { TestDetail, StageInput } from "./verify";

export type FailureCategory =
  | "missing_file"
  | "import_error"
  | "type_error"
  | "generate_error"
  | "logic_error"
  | "api_misuse"
  | "runner_error";

export type StageResult = {
  stage: "generate" | "typecheck" | "tests";
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

export type ProblemResult = {
  problemId: string;
  problemName: string;
  difficulty: string;
  category: string;
  stages: StageResult[];
  totalScore: number;
  maxScore: number;
  totalDurationMs?: number;
};

export type SuccessRate = { passed: number; total: number; rate: number };

type FailurePattern = {
  pattern: string;
  count: number;
  affectedProblems: string[];
  suggestedDocFix: string;
};

type Analytics = {
  failureDistribution: Partial<Record<FailureCategory, number>>;
  categorySuccessRates: Record<string, SuccessRate>;
  difficultySuccessRates: Record<string, SuccessRate>;
  stagePassRates: Record<string, SuccessRate>;
  commonFailurePatterns: FailurePattern[];
};

export type ChallengeReport = {
  timestamp: string;
  sdkVersion?: string;
  results: ProblemResult[];
  totalScore: number;
  maxScore: number;
  percentage: number;
  weightedScore: number;
  weightedMaxScore: number;
  weightedPercentage: number;
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
    runner_error: "Runner error - investigate runner bug or problem setup",
  },
  typecheck: {
    missing_file: "Add file creation checklist to problem scaffold",
    import_error: "Document all SDK export paths and re-exports",
    type_error: "Add JSDoc with @example to SDK types (especially generics)",
    generate_error: "Ensure generated types include all required fields",
    logic_error: "Add type usage patterns for complex SDK APIs",
    api_misuse: "Add type-level validation with better error messages",
    runner_error: "Runner error - investigate runner bug or problem setup",
  },
  tests: {
    missing_file: "Add file structure documentation",
    import_error: "Document module resolution for generated files",
    type_error: "Add runtime type checking examples",
    generate_error: "Improve generated code correctness",
    logic_error: "Add more logic examples (resolver body, executor handler, workflow jobs)",
    api_misuse: "Add API usage examples with edge cases and error handling",
    runner_error: "Runner error - investigate runner bug or problem setup",
  },
};

function getSuggestedDocFix(stage: string, category: FailureCategory): string {
  return (
    failureDocSuggestions[stage]?.[category] ?? `Improve ${category} documentation for ${stage}`
  );
}

function classifyFailure(
  stage: "generate" | "typecheck" | "tests",
  output: string,
): FailureCategory | undefined {
  if (/^Skipped\b/.test(output)) {
    return undefined;
  }
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
  if (stage === "typecheck") {
    return "type_error";
  }
  return "logic_error";
}

export function calculateScore(meta: ProblemMeta, stages: StageInput[]): StageResult[] {
  return stages.map((s) => {
    const maxScore = meta.scoring[s.stage];
    const category = s.passed ? undefined : classifyFailure(s.stage, s.output);

    if (s.testsTotal != null && s.testsTotal > 0) {
      const testsPassed = s.testsPassed ?? 0;
      const score =
        testsPassed === s.testsTotal
          ? maxScore
          : Math.min(Math.round((testsPassed / s.testsTotal) * maxScore), maxScore - 1);
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

  return {
    failureDistribution,
    categorySuccessRates,
    difficultySuccessRates,
    stagePassRates,
    commonFailurePatterns,
  };
}

export function createReport(
  results: ProblemResult[],
  metadata?: { sdkVersion?: string; elapsedMs?: number },
): ChallengeReport {
  const totalScore = results.reduce((sum, r) => sum + r.totalScore, 0);
  const maxScore = results.reduce((sum, r) => sum + r.maxScore, 0);

  let weightedScore = 0;
  let weightedMaxScore = 0;
  for (const r of results) {
    const weight = difficultyWeights[r.difficulty] ?? 1.0;
    weightedScore += r.totalScore * weight;
    weightedMaxScore += r.maxScore * weight;
  }

  const totalDurationMs =
    metadata?.elapsedMs ?? results.reduce((sum, r) => sum + (r.totalDurationMs ?? 0), 0);

  const analytics = computeAnalytics(results);

  return {
    timestamp: new Date().toISOString(),
    sdkVersion: metadata?.sdkVersion,
    results,
    totalScore,
    maxScore,
    percentage: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0,
    weightedScore: Math.round(weightedScore * 10) / 10,
    weightedMaxScore: Math.round(weightedMaxScore * 10) / 10,
    weightedPercentage:
      weightedMaxScore > 0 ? Math.round((weightedScore / weightedMaxScore) * 100) : 0,
    totalDurationMs,
    analytics,
  };
}

export function formatReportTable(report: ChallengeReport): string {
  const width = 90;

  const lines: string[] = [];
  lines.push("=".repeat(width));
  lines.push("Challenge Results");
  lines.push("=".repeat(width));
  lines.push("");

  const header =
    "Problem".padEnd(30) + "Difficulty".padEnd(12) + "Score".padEnd(15) + "Status".padEnd(10);
  lines.push(header);
  lines.push("-".repeat(width));

  for (const r of report.results) {
    const nameRaw = problemKey(r.problemId, r.problemName);
    const name = (nameRaw.length > 29 ? `${nameRaw.slice(0, 28)}…` : nameRaw).padEnd(30);
    const diff = r.difficulty.padEnd(12);
    const score = `${r.totalScore}/${r.maxScore}`.padEnd(15);
    let statusLabel = "PARTIAL";
    if (r.totalScore === r.maxScore) {
      statusLabel = "PASS";
    } else if (r.totalScore === 0) {
      statusLabel = "FAIL";
    }
    const status = statusLabel.padEnd(10);
    lines.push(`${name}${diff}${score}${status}`);

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

  lines.push("-".repeat(width));
  lines.push(
    `${"Total".padEnd(30)}${"".padEnd(12)}${`${report.totalScore}/${report.maxScore}`.padEnd(15)}${`${report.percentage}%`.padEnd(10)}`,
  );

  lines.push(
    `${"Weighted".padEnd(30)}${"".padEnd(12)}${`${report.weightedScore}/${report.weightedMaxScore}`.padEnd(15)}${`${report.weightedPercentage}%`}`,
  );

  if (report.totalDurationMs > 0) {
    const totalSecs = report.totalDurationMs / 1000;
    const mins = Math.floor(totalSecs / 60);
    const secs = Math.round(totalSecs % 60);
    lines.push(`Total duration: ${mins}m ${secs}s`);
  }

  if (report.results.length > 0 && report.results.every((r) => r.totalScore === r.maxScore)) {
    lines.push("");
    lines.push(
      "WARNING: All problems passed — consider increasing difficulty or adding harder problems",
    );
  }

  lines.push("=".repeat(width));

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

  if (analytics.commonFailurePatterns.length > 0) {
    lines.push("");
    lines.push("Common Failure Patterns:");
    for (const p of analytics.commonFailurePatterns) {
      lines.push(`  ${p.pattern} (${p.count}x) -> ${p.suggestedDocFix}`);
    }
  }

  return lines.join("\n");
}
