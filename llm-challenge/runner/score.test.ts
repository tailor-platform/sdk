import { describe, expect, it } from "vitest";
import type { ProblemMeta } from "../shared/helpers";
import { calculateScore, createReport } from "./score";
import type { ProblemResult } from "./score";

const baseMeta: ProblemMeta = {
  id: "999",
  name: "score-fixture",
  difficulty: "easy",
  category: "api-design",
  scoring: { generate: 10, typecheck: 10, tests: 10 },
  files: { implement: ["x.ts"], scaffold: [] },
};

const apiCheckMeta: ProblemMeta = {
  ...baseMeta,
  scoring: { generate: 10, apiCheck: 10, typecheck: 10, tests: 10 },
};

describe("calculateScore", () => {
  it("clamps partial scores at 0 when the stage has no points configured", () => {
    const result = calculateScore(baseMeta, [
      {
        stage: "apiCheck",
        passed: false,
        output: "Some checks failed",
        testsPassed: 0,
        testsTotal: 5,
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.maxScore).toBe(0);
    expect(result[0]?.score).toBe(0);
  });

  it("awards proportional partial credit when tests are weighted", () => {
    const result = calculateScore(baseMeta, [
      {
        stage: "tests",
        passed: false,
        output: "Some failed",
        testsPassed: 5,
        testsTotal: 10,
      },
    ]);

    expect(result[0]?.maxScore).toBe(10);
    expect(result[0]?.score).toBe(5);
  });

  it("classifies failed apiCheck stage as api_design", () => {
    const result = calculateScore(apiCheckMeta, [
      {
        stage: "apiCheck",
        passed: false,
        output: "Missing required pattern: type-level-hooks-api",
        testsPassed: 2,
        testsTotal: 3,
      },
    ]);

    expect(result[0]?.category).toBe("api_design");
  });

  it("does not classify a skipped apiCheck stage", () => {
    const result = calculateScore(apiCheckMeta, [
      {
        stage: "apiCheck",
        passed: false,
        output: "Skipped (generate failed)",
      },
    ]);

    expect(result[0]?.category).toBeUndefined();
  });
});

function makeProblemResult(overrides: Partial<ProblemResult> = {}): ProblemResult {
  return {
    problemId: "999",
    problemName: "fixture",
    difficulty: "easy",
    category: "api-design",
    stages: [],
    totalScore: 0,
    maxScore: 0,
    ...overrides,
  };
}

describe("createReport", () => {
  it("propagates contextProfile metadata onto the report", () => {
    const results: ProblemResult[] = [
      makeProblemResult({ totalScore: 10, maxScore: 10 }),
      makeProblemResult({ problemId: "002", totalScore: 0, maxScore: 10 }),
    ];

    const report = createReport(results, { contextProfile: "mixed" });

    expect(report.contextProfile).toBe("mixed");
    expect(report.totalScore).toBe(10);
    expect(report.maxScore).toBe(20);
    expect(report.percentage).toBe(50);
  });
});
