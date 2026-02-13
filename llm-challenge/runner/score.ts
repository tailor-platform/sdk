import type { ProblemMeta } from "../shared/helpers";
import type { SolveResult } from "./solve";
import type { StageInput } from "./verify";

export type FailureCategory =
  | "missing_file"
  | "import_error"
  | "type_error"
  | "generate_error"
  | "logic_error"
  | "api_misuse"
  | undefined;

export type StageResult = {
  stage: "generate" | "typecheck" | "tests";
  passed: boolean;
  output: string;
  score: number;
  maxScore: number;
  category?: FailureCategory;
};

export type ProblemResult = {
  problemId: string;
  problemName: string;
  difficulty: string;
  category: string;
  stages: StageResult[];
  totalScore: number;
  maxScore: number;
  solveResult?: SolveResult;
  retryCount?: number;
  retrySolveResults?: SolveResult[];
};

export type ChallengeReport = {
  timestamp: string;
  model?: string;
  sdkVersion?: string;
  results: ProblemResult[];
  totalScore: number;
  maxScore: number;
  percentage: number;
  totalCostUsd: number;
};

function classifyFailure(
  stage: "generate" | "typecheck" | "tests",
  output: string,
): FailureCategory {
  if (/does not exist|ENOENT/.test(output)) {
    return "missing_file";
  }
  if (/Cannot find module|does not provide an export/.test(output)) {
    return "import_error";
  }
  if (/TS\d{4}/.test(output)) {
    return "type_error";
  }
  if (stage === "generate") {
    if (/validation|invalid|schema/i.test(output)) {
      return "api_misuse";
    }
    return "generate_error";
  }
  if (stage === "tests") {
    return "logic_error";
  }
  return undefined;
}

export function calculateScore(meta: ProblemMeta, stages: StageInput[]): StageResult[] {
  return stages.map((s) => {
    const maxScore = meta.scoring[s.stage];
    const category = s.passed ? undefined : classifyFailure(s.stage, s.output);

    // Partial scoring for tests stage
    if (s.stage === "tests" && s.testsTotal != null && s.testsTotal > 0) {
      const testsPassed = s.testsPassed ?? 0;
      const score =
        testsPassed === s.testsTotal
          ? maxScore
          : Math.round((testsPassed / s.testsTotal) * maxScore);
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

export function createReport(
  results: ProblemResult[],
  metadata?: { model?: string; sdkVersion?: string },
): ChallengeReport {
  const totalScore = results.reduce((sum, r) => sum + r.totalScore, 0);
  const maxScore = results.reduce((sum, r) => sum + r.maxScore, 0);
  const totalCostUsd = results.reduce((sum, r) => {
    let cost = r.solveResult?.costUsd ?? 0;
    if (r.retrySolveResults) {
      cost += r.retrySolveResults.reduce((s, rs) => s + rs.costUsd, 0);
    }
    return sum + cost;
  }, 0);
  return {
    timestamp: new Date().toISOString(),
    model: metadata?.model,
    sdkVersion: metadata?.sdkVersion,
    results,
    totalScore,
    maxScore,
    percentage: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0,
    totalCostUsd,
  };
}

export function formatReportTable(report: ChallengeReport): string {
  const hasCost = report.results.some((r) => r.solveResult !== undefined);
  const width = hasCost ? 92 : 80;

  const lines: string[] = [];
  lines.push("=".repeat(width));
  lines.push("Challenge Results");
  lines.push("=".repeat(width));
  lines.push("");

  let header =
    "Problem".padEnd(30) + "Difficulty".padEnd(12) + "Score".padEnd(15) + "Status".padEnd(10);
  if (hasCost) {
    header += "Cost";
  }
  lines.push(header);
  lines.push("-".repeat(width));

  for (const r of report.results) {
    const name = `${r.problemId}-${r.problemName}`.padEnd(30);
    const diff = r.difficulty.padEnd(12);
    const score = `${r.totalScore}/${r.maxScore}`.padEnd(15);
    const status = (r.totalScore === r.maxScore ? "PASS" : "PARTIAL").padEnd(10);
    let line = `${name}${diff}${score}${status}`;
    if (hasCost && r.solveResult) {
      line += `$${r.solveResult.costUsd.toFixed(4)}`;
    }
    lines.push(line);

    for (const s of r.stages) {
      const stageName = `  ${s.stage}`.padEnd(30);
      const stageScore = `${s.score}/${s.maxScore}`.padEnd(15);
      const stageStatus = s.passed ? "ok" : s.score > 0 ? "PARTIAL" : "FAIL";
      const categoryLabel = s.category ? ` [${s.category}]` : "";
      lines.push(`${stageName}${"".padEnd(12)}${stageScore}${stageStatus}${categoryLabel}`);
    }
  }

  lines.push("-".repeat(width));
  let totalLine = `${"Total".padEnd(30)}${"".padEnd(12)}${`${report.totalScore}/${report.maxScore}`.padEnd(15)}${`${report.percentage}%`.padEnd(10)}`;
  if (hasCost) {
    totalLine += `$${report.totalCostUsd.toFixed(4)}`;
  }
  lines.push(totalLine);
  lines.push("=".repeat(width));

  return lines.join("\n");
}
