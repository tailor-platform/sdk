import { describe, expect, it } from "vitest";
import type { ProblemMeta } from "../shared/helpers";
import { getRedesignSuggestion } from "./affordance";
import { calculateScore, createReport } from "./score";
import type { ProblemResult, StageResult } from "./score";

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

  it("computes an affordance alongside the failure category", () => {
    const result = calculateScore(apiCheckMeta, [
      {
        stage: "apiCheck",
        passed: false,
        output: "Forbidden pattern matched: legacy-hyphenated-generator-package",
        testsPassed: 0,
        testsTotal: 1,
      },
    ]);

    expect(result[0]?.category).toBe("api_design");
    expect(result[0]?.affordance).toBe("naming_bias");
  });

  it("considers failed test names when classifying a logic_error affordance", () => {
    const result = calculateScore(baseMeta, [
      {
        stage: "tests",
        passed: false,
        output: "Tests failed",
        testsPassed: 0,
        testsTotal: 1,
        testDetails: [
          {
            name: "invoiceCreated executor has non-empty description",
            status: "failed",
            failureMessage: "Expected description to be non-empty",
          },
        ],
      },
    ]);

    expect(result[0]?.category).toBe("logic_error");
    expect(result[0]?.affordance).toBe("missing_action_verb");
  });

  it("does not attach an affordance to a passing stage", () => {
    const result = calculateScore(baseMeta, [
      {
        stage: "tests",
        passed: true,
        output: "All tests passed",
        testsPassed: 10,
        testsTotal: 10,
      },
    ]);

    expect(result[0]?.category).toBeUndefined();
    expect(result[0]?.affordance).toBeUndefined();
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

  it("aggregates per-split scores and emits an overfit gap warning when train outpaces holdout", () => {
    const passingStage = (max: number): StageResult => ({
      stage: "tests",
      passed: true,
      output: "ok",
      score: max,
      maxScore: max,
    });
    const failingStage = (max: number): StageResult => ({
      stage: "tests",
      passed: false,
      output: "fail",
      score: 0,
      maxScore: max,
      category: "logic_error",
    });
    const results: ProblemResult[] = [
      makeProblemResult({
        problemId: "001",
        split: "train",
        stages: [passingStage(100)],
        totalScore: 100,
        maxScore: 100,
      }),
      makeProblemResult({
        problemId: "002",
        split: "train",
        stages: [passingStage(100)],
        totalScore: 100,
        maxScore: 100,
      }),
      makeProblemResult({
        problemId: "003",
        split: "holdout",
        stages: [failingStage(100)],
        totalScore: 30,
        maxScore: 100,
      }),
    ];

    const report = createReport(results);

    expect(report.analytics.splitAggregates.train?.percentage).toBe(100);
    expect(report.analytics.splitAggregates.train?.problemCount).toBe(2);
    expect(report.analytics.splitAggregates.holdout?.percentage).toBe(30);
    expect(report.analytics.overfitGap).toBe(70);
  });

  it("treats a result without an explicit split as train for aggregation", () => {
    const results: ProblemResult[] = [
      makeProblemResult({
        problemId: "legacy",
        // Note: no `split` field — simulates a historic report parsed back in.
        totalScore: 50,
        maxScore: 100,
      }),
    ];

    const report = createReport(results);

    expect(report.analytics.splitAggregates.train?.problemCount).toBe(1);
    expect(report.analytics.splitAggregates.holdout).toBeUndefined();
    expect(report.analytics.overfitGap).toBeUndefined();
  });

  it("returns undefined overfitGap when only the holdout split has results", () => {
    const failingStage: StageResult = {
      stage: "tests",
      passed: false,
      output: "fail",
      score: 0,
      maxScore: 100,
      category: "logic_error",
    };
    const results: ProblemResult[] = [
      makeProblemResult({
        problemId: "002",
        split: "holdout",
        stages: [failingStage],
        totalScore: 30,
        maxScore: 100,
      }),
    ];

    const report = createReport(results);

    expect(report.analytics.splitAggregates.train).toBeUndefined();
    expect(report.analytics.splitAggregates.holdout?.problemCount).toBe(1);
    // Gap requires both train and holdout to have at least one problem.
    expect(report.analytics.overfitGap).toBeUndefined();
  });

  it("summarizes token usage across solve attempts and computes tokens-per-point", () => {
    const results: ProblemResult[] = [
      makeProblemResult({
        problemId: "001",
        totalScore: 100,
        maxScore: 100,
        solveResult: {
          success: true,
          costUsd: 0,
          durationMs: 0,
          output: "",
          usage: {
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadTokens: 8000,
            numTurns: 10,
          },
        },
      }),
      makeProblemResult({
        problemId: "002",
        totalScore: 100,
        maxScore: 100,
        solveResult: {
          success: true,
          costUsd: 0,
          durationMs: 0,
          output: "",
          usage: {
            inputTokens: 1500,
            outputTokens: 700,
            cacheReadTokens: 12000,
            numTurns: 14,
          },
        },
      }),
    ];

    const report = createReport(results);

    expect(report.usageSummary).toEqual({
      inputTokens: 2500,
      outputTokens: 1200,
      cacheReadTokens: 20000,
      numTurns: 24,
      tokensPerPoint: Math.round((2500 + 1200 + 20000) / 200),
    });
  });

  it("omits usageSummary when no adapter reported usage", () => {
    const results: ProblemResult[] = [makeProblemResult({ totalScore: 10, maxScore: 10 })];

    expect(createReport(results).usageSummary).toBeUndefined();
  });

  it("aggregates affordance distribution and surfaces repeated patterns with API redesign info", () => {
    const failingStage = (affordance: StageResult["affordance"]): StageResult => ({
      stage: "tests",
      passed: false,
      output: "logic failure",
      score: 0,
      maxScore: 10,
      category: "logic_error",
      ...(affordance ? { affordance } : {}),
    });
    const results: ProblemResult[] = [
      makeProblemResult({
        problemId: "001",
        category: "integration",
        stages: [failingStage("consolidation_candidate")],
        totalScore: 0,
        maxScore: 10,
      }),
      makeProblemResult({
        problemId: "002",
        category: "integration",
        stages: [failingStage("consolidation_candidate")],
        totalScore: 0,
        maxScore: 10,
      }),
    ];

    const report = createReport(results);

    const expected = getRedesignSuggestion("consolidation_candidate");
    expect(report.analytics.affordanceDistribution.consolidation_candidate).toBe(2);
    expect(report.analytics.commonFailurePatterns).toHaveLength(1);
    const pattern = report.analytics.commonFailurePatterns[0]!;
    expect(pattern.affordance).toBe("consolidation_candidate");
    expect(pattern.apiChange).toBe(expected.apiChange);
    expect(pattern.docFallback).toBe(expected.docFallback);
    expect(pattern.anthropicAnalog).toBe(expected.anthropicAnalog);
    // suggestedDocFix mirrors apiChange for back-compat with pre-affordance
    // report consumers; assert against the canonical source, not the field
    // itself, so the mirror logic is exercised rather than tautologically
    // satisfied.
    expect(pattern.suggestedDocFix).toBe(expected.apiChange);
  });
});
