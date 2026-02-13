import type { ProblemMeta } from "../shared/helpers";

export type StageResult = {
  stage: "generate" | "typecheck" | "tests";
  passed: boolean;
  output: string;
  score: number;
  maxScore: number;
};

export type ProblemResult = {
  problemId: string;
  problemName: string;
  difficulty: string;
  category: string;
  stages: StageResult[];
  totalScore: number;
  maxScore: number;
};

export type BenchmarkReport = {
  timestamp: string;
  results: ProblemResult[];
  totalScore: number;
  maxScore: number;
  percentage: number;
};

export function calculateScore(
  meta: ProblemMeta,
  stages: { stage: "generate" | "typecheck" | "tests"; passed: boolean; output: string }[],
): StageResult[] {
  return stages.map((s) => ({
    ...s,
    score: s.passed ? meta.scoring[s.stage] : 0,
    maxScore: meta.scoring[s.stage],
  }));
}

export function createReport(results: ProblemResult[]): BenchmarkReport {
  const totalScore = results.reduce((sum, r) => sum + r.totalScore, 0);
  const maxScore = results.reduce((sum, r) => sum + r.maxScore, 0);
  return {
    timestamp: new Date().toISOString(),
    results,
    totalScore,
    maxScore,
    percentage: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0,
  };
}

export function formatReportTable(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push("=".repeat(80));
  lines.push("Benchmark Results");
  lines.push("=".repeat(80));
  lines.push("");

  const header = "Problem".padEnd(30) + "Difficulty".padEnd(12) + "Score".padEnd(15) + "Status";
  lines.push(header);
  lines.push("-".repeat(80));

  for (const r of report.results) {
    const name = `${r.problemId}-${r.problemName}`.padEnd(30);
    const diff = r.difficulty.padEnd(12);
    const score = `${r.totalScore}/${r.maxScore}`.padEnd(15);
    const status = r.totalScore === r.maxScore ? "PASS" : "PARTIAL";
    lines.push(`${name}${diff}${score}${status}`);

    for (const s of r.stages) {
      const stageName = `  ${s.stage}`.padEnd(30);
      const stageScore = `${s.score}/${s.maxScore}`.padEnd(15);
      const stageStatus = s.passed ? "ok" : "FAIL";
      lines.push(`${stageName}${"".padEnd(12)}${stageScore}${stageStatus}`);
    }
  }

  lines.push("-".repeat(80));
  lines.push(
    `${"Total".padEnd(30)}${"".padEnd(12)}${`${report.totalScore}/${report.maxScore}`.padEnd(15)}${report.percentage}%`,
  );
  lines.push("=".repeat(80));

  return lines.join("\n");
}
