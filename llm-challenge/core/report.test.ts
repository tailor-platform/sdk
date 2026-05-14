import { describe, expect, it } from "vitest";
import type { ReadTargetClass, TraceMetrics } from "./metrics";
import {
  type ProblemResult,
  type StageResult,
  aggregateIterations,
  computeSuccessRates,
  createReport,
  finalizeStages,
  formatReportTable,
  isInfraFailure,
} from "./report";

function emptyReadTargets(): Record<ReadTargetClass, number> {
  return {
    "sdk-dts": 0,
    "sdk-package-src": 0,
    "sdk-docs": 0,
    "problem-files": 0,
    other: 0,
  };
}

function mkMetrics(partial: Partial<TraceMetrics>): TraceMetrics {
  return {
    turns: 0,
    toolCallCounts: {},
    readTargets: emptyReadTargets(),
    readSdkDts: 0,
    readDocs: 0,
    bashRetries: 0,
    ...partial,
  };
}

function makeProblemResult(overrides: Partial<ProblemResult> = {}): ProblemResult {
  return {
    problemId: "999",
    problemName: "fixture",
    difficulty: "easy",
    category: "api-design",
    stages: [],
    passed: false,
    ...overrides,
  };
}

describe("finalizeStages", () => {
  it("preserves stage shape and passes through testDetails", () => {
    const result = finalizeStages([
      {
        stage: "tests",
        passed: false,
        output: "1 of 2 failed",
        testsPassed: 1,
        testsTotal: 2,
        testDetails: [
          { name: "a", status: "passed" },
          { name: "b", status: "failed", failureMessage: "bad" },
        ],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      stage: "tests",
      passed: false,
      testsPassed: 1,
      testsTotal: 2,
    });
    expect(result[0]?.testDetails).toHaveLength(2);
  });
});

describe("createReport", () => {
  it("aggregates problemsPassed and percentage", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const failing: StageResult = { stage: "tests", passed: false, output: "fail" };

    const results: ProblemResult[] = [
      makeProblemResult({ stages: [passing], passed: true }),
      makeProblemResult({ problemId: "002", stages: [failing], passed: false }),
    ];

    const report = createReport(results, { contextProfile: "types-only" });

    expect(report.contextProfile).toBe("types-only");
    expect(report.problemsPassed).toBe(1);
    expect(report.problemsTotal).toBe(2);
    expect(report.percentage).toBe(50);
  });

  it("summarizes token usage across solve attempts", () => {
    const results: ProblemResult[] = [
      makeProblemResult({
        problemId: "001",
        passed: true,
        solveResult: {
          success: true,
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
        passed: true,
        solveResult: {
          success: true,
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
    });
  });

  it("omits usageSummary when no adapter reported usage", () => {
    const results: ProblemResult[] = [makeProblemResult({ passed: true })];

    expect(createReport(results).usageSummary).toBeUndefined();
  });

  it("computes stage pass rates excluding skipped stages", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const skipped: StageResult = { stage: "tests", passed: false, output: "Skipped (foo)" };
    const failing: StageResult = { stage: "tests", passed: false, output: "fail" };

    const results: ProblemResult[] = [
      makeProblemResult({ stages: [passing], passed: true }),
      makeProblemResult({ problemId: "002", stages: [failing], passed: false }),
      makeProblemResult({ problemId: "003", stages: [skipped], passed: false }),
    ];

    const report = createReport(results);

    // skipped should not count toward total
    expect(report.analytics.stagePassRates.tests).toEqual({
      passed: 1,
      total: 2,
      rate: 50,
    });
  });

  it("treats an all-infra-failure report as 0% valid with infraFailureCount === results.length", () => {
    const infraStages: StageResult[] = [
      { stage: "generate", passed: false, output: "Skipped (infrastructure failure)" },
      { stage: "typecheck", passed: false, output: "Skipped (infrastructure failure)" },
      { stage: "tests", passed: false, output: "Skipped (infrastructure failure)" },
    ];
    const results: ProblemResult[] = [
      makeProblemResult({ problemId: "001", stages: infraStages, passed: false }),
      makeProblemResult({ problemId: "002", stages: infraStages, passed: false }),
    ];

    const report = createReport(results);

    expect(report.infraFailureCount).toBe(results.length);
    expect(report.validPercentage).toBe(0);
    expect(report.percentage).toBe(0);
  });

  it("never writes the legacy totalCostUsd / costPerPass fields on a fresh OSS-era report", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const results: ProblemResult[] = [
      makeProblemResult({
        problemId: "001",
        stages: [passing],
        passed: true,
        solveResult: { success: true, durationMs: 0, output: "" },
      }),
    ];

    const report = createReport(results);

    expect(report.totalCostUsd).toBeUndefined();
    expect(report.costPerPass).toBeUndefined();
    expect("totalCostUsd" in report).toBe(false);
    expect("costPerPass" in report).toBe(false);
  });

  it("rounds percentage to the nearest integer (1 of 3 → 33, 2 of 3 → 67)", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const failing: StageResult = { stage: "tests", passed: false, output: "fail" };

    const oneOfThree: ProblemResult[] = [
      makeProblemResult({ problemId: "001", stages: [passing], passed: true }),
      makeProblemResult({ problemId: "002", stages: [failing], passed: false }),
      makeProblemResult({ problemId: "003", stages: [failing], passed: false }),
    ];
    expect(createReport(oneOfThree).percentage).toBe(33);

    const twoOfThree: ProblemResult[] = [
      makeProblemResult({ problemId: "001", stages: [passing], passed: true }),
      makeProblemResult({ problemId: "002", stages: [passing], passed: true }),
      makeProblemResult({ problemId: "003", stages: [failing], passed: false }),
    ];
    expect(createReport(twoOfThree).percentage).toBe(67);
  });

  it("separates infra failures from valid pass-rate calculations", () => {
    const infraStages: StageResult[] = [
      { stage: "generate", passed: false, output: "Skipped (infrastructure failure)" },
      { stage: "typecheck", passed: false, output: "Skipped (infrastructure failure)" },
      { stage: "tests", passed: false, output: "Skipped (infrastructure failure)" },
    ];
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };

    const results: ProblemResult[] = [
      makeProblemResult({
        problemId: "001",
        stages: [passing],
        passed: true,
        solveResult: { success: true, durationMs: 0, output: "" },
      }),
      makeProblemResult({
        problemId: "002",
        stages: infraStages,
        passed: false,
        solveResult: { success: false, durationMs: 0, output: "", infraFailure: true },
      }),
    ];

    const report = createReport(results);

    expect(report.infraFailureCount).toBe(1);
    // Valid percentage excludes the infra failure.
    expect(report.validPercentage).toBe(100);
    expect(report.problemsTotal).toBe(2);
  });
});

describe("isInfraFailure", () => {
  it("returns true when every stage is the infra-failure sentinel", () => {
    const result = makeProblemResult({
      stages: [
        { stage: "generate", passed: false, output: "Skipped (infrastructure failure)" },
        { stage: "typecheck", passed: false, output: "Skipped (infrastructure failure)" },
        { stage: "tests", passed: false, output: "Skipped (infrastructure failure)" },
      ],
    });

    expect(isInfraFailure(result)).toBe(true);
  });

  it("returns false when at least one stage is not an infra-failure skip", () => {
    const result = makeProblemResult({
      stages: [
        { stage: "generate", passed: true, output: "ok" },
        { stage: "typecheck", passed: false, output: "Skipped (generate failed)" },
        { stage: "tests", passed: false, output: "Skipped (generate failed)" },
      ],
    });

    expect(isInfraFailure(result)).toBe(false);
  });

  it("returns false for a result with no stages", () => {
    expect(isInfraFailure(makeProblemResult({ stages: [] }))).toBe(false);
  });
});

describe("computeSuccessRates", () => {
  it("computes pass rates by key", () => {
    const items = [
      { key: "a", pass: true },
      { key: "a", pass: false },
      { key: "b", pass: true },
    ];

    const rates = computeSuccessRates(
      items,
      (i) => i.key,
      (i) => i.pass,
    );

    expect(rates).toEqual({
      a: { passed: 1, total: 2, rate: 50 },
      b: { passed: 1, total: 1, rate: 100 },
    });
  });
});

describe("formatReportTable", () => {
  it("never renders a Cost column or dollar figures (OSS-era reports have no cost)", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const report = createReport([
      makeProblemResult({
        stages: [passing],
        passed: true,
        solveResult: { success: true, durationMs: 0, output: "" },
      }),
    ]);
    const table = formatReportTable(report);
    expect(table).not.toContain("Cost");
    expect(table).not.toContain("$");
  });

  it("renders INFRA status when every stage is the infra-failure sentinel", () => {
    const infraStages: StageResult[] = [
      { stage: "generate", passed: false, output: "Skipped (infrastructure failure)" },
      { stage: "typecheck", passed: false, output: "Skipped (infrastructure failure)" },
      { stage: "tests", passed: false, output: "Skipped (infrastructure failure)" },
    ];
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const report = createReport([
      makeProblemResult({ problemId: "001", stages: [passing], passed: true }),
      makeProblemResult({
        problemId: "002",
        stages: infraStages,
        passed: false,
        solveResult: { success: false, durationMs: 0, output: "", infraFailure: true },
      }),
    ]);

    const table = formatReportTable(report);

    expect(table).toContain("INFRA");
    // Pass label still appears for the passing problem.
    expect(table).toContain("PASS");
  });

  it("renders test count and duration labels when stages report them", () => {
    const stage: StageResult = {
      stage: "tests",
      passed: false,
      output: "1 of 2 failed",
      testsPassed: 1,
      testsTotal: 2,
      durationMs: 4500,
    };
    const report = createReport([makeProblemResult({ stages: [stage], passed: false })]);

    const table = formatReportTable(report);

    expect(table).toContain("(1/2 tests)");
    expect(table).toContain("4.5s");
  });

  it("renders the 'Valid (excl. infra)' line only when there are infra failures", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const infraStages: StageResult[] = [
      { stage: "tests", passed: false, output: "Skipped (infrastructure failure)" },
    ];

    const withInfra = createReport([
      makeProblemResult({ problemId: "001", stages: [passing], passed: true }),
      makeProblemResult({ problemId: "002", stages: infraStages, passed: false }),
    ]);
    expect(formatReportTable(withInfra)).toContain("Valid (excl. infra)");

    const withoutInfra = createReport([makeProblemResult({ stages: [passing], passed: true })]);
    expect(formatReportTable(withoutInfra)).not.toContain("Valid (excl. infra)");
  });

  it("warns when every valid result passed", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const allPass = createReport([
      makeProblemResult({ problemId: "001", stages: [passing], passed: true }),
      makeProblemResult({ problemId: "002", stages: [passing], passed: true }),
    ]);
    expect(formatReportTable(allPass)).toContain("All problems passed");

    const someFail = createReport([
      makeProblemResult({ problemId: "001", stages: [passing], passed: true }),
      makeProblemResult({
        problemId: "002",
        stages: [{ stage: "tests", passed: false, output: "fail" }],
        passed: false,
      }),
    ]);
    expect(formatReportTable(someFail)).not.toContain("All problems passed");
  });

  it("renders a scaffoldChanges warning when any result modified scaffold files", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const report = createReport([
      makeProblemResult({
        stages: [passing],
        passed: true,
        scaffoldChanges: [{ file: "tailor.config.ts", original: "a", modified: "b" }],
      }),
    ]);

    const table = formatReportTable(report);

    expect(table).toContain("Scaffold files modified during solve");
    expect(table).toContain("tailor.config.ts");
  });

  it("never renders the Cost per pass: line on fresh OSS-era reports", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const report = createReport([
      makeProblemResult({
        stages: [passing],
        passed: true,
        solveResult: { success: true, durationMs: 0, output: "" },
      }),
    ]);
    expect(formatReportTable(report)).not.toContain("Cost per pass:");
  });

  it("renders the usageSummary block when at least one solveResult reports usage", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const withUsage = createReport([
      makeProblemResult({
        stages: [passing],
        passed: true,
        solveResult: {
          success: true,
          durationMs: 0,
          output: "",
          usage: {
            inputTokens: 1500,
            outputTokens: 800,
            cacheReadTokens: 20000,
            numTurns: 12,
          },
        },
      }),
    ]);

    const table = formatReportTable(withUsage);
    expect(table).toContain("Token usage:");
    expect(table).toContain("input=1,500");
    expect(table).toContain("output=800");
    expect(table).toContain("cacheRead=20,000");
    expect(table).toContain("turns=12");

    const noUsage = createReport([makeProblemResult({ stages: [passing], passed: true })]);
    expect(formatReportTable(noUsage)).not.toContain("Token usage:");
  });

  it("renders the Stage Pass Rates section with per-stage percentages", () => {
    const passing = (stage: "generate" | "typecheck" | "tests"): StageResult => ({
      stage,
      passed: true,
      output: "ok",
    });
    const failing = (stage: "generate" | "typecheck" | "tests"): StageResult => ({
      stage,
      passed: false,
      output: "fail",
    });

    const report = createReport([
      makeProblemResult({
        problemId: "001",
        stages: [passing("generate"), passing("typecheck"), passing("tests")],
        passed: true,
      }),
      makeProblemResult({
        problemId: "002",
        stages: [passing("generate"), failing("typecheck"), failing("tests")],
        passed: false,
      }),
    ]);

    const table = formatReportTable(report);

    expect(table).toContain("Stage Pass Rates:");
    // generate: 2/2 (100%), typecheck: 1/2 (50%), tests: 1/2 (50%)
    expect(table).toContain("generate");
    expect(table).toContain("2/2 (100%)");
    expect(table).toContain("typecheck");
    expect(table).toContain("tests");
    expect(table).toContain("1/2 (50%)");
  });

  it("renders the per-problem behaviour trace line when metrics exist", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const report = createReport([
      makeProblemResult({
        stages: [passing],
        passed: true,
        metrics: mkMetrics({
          turns: 12,
          toolCallCounts: { Read: 5, Bash: 3, Edit: 4 },
          readSdkDts: 4,
          readDocs: 2,
          bashRetries: 3,
        }),
      }),
    ]);

    const table = formatReportTable(report);
    expect(table).toContain("trace");
    expect(table).toContain("turns=12");
    expect(table).toContain("read_sdk=4");
    expect(table).toContain("read_docs=2");
    expect(table).toContain("bash_retries=3");
  });

  it("suppresses the trace line when all metric counters are zero", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const report = createReport([
      makeProblemResult({
        stages: [passing],
        passed: true,
        metrics: mkMetrics({}),
      }),
    ]);

    expect(formatReportTable(report)).not.toContain("turns=0");
  });

  it("renders the aggregate Behaviour Metrics block when any result has metrics", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const report = createReport([
      makeProblemResult({
        problemId: "001",
        stages: [passing],
        passed: true,
        metrics: mkMetrics({
          turns: 8,
          toolCallCounts: { Read: 4, Bash: 2, Edit: 2 },
          readSdkDts: 2,
          readDocs: 1,
          bashRetries: 1,
        }),
      }),
      makeProblemResult({
        problemId: "002",
        stages: [passing],
        passed: true,
        metrics: mkMetrics({
          turns: 14,
          toolCallCounts: { Read: 8, Bash: 4, Edit: 2 },
          readSdkDts: 4,
          readDocs: 0,
          bashRetries: 3,
        }),
      }),
    ]);

    const table = formatReportTable(report);
    expect(table).toContain("Behaviour Metrics");
    expect(table).toContain("turns");
    // Aggregates: turns min=8, max=14, median=11, mean=11.0
    expect(table).toMatch(/turns\s+min=8\s+median=11\s+max=14\s+mean=11\.0/);
    expect(report.analytics.metricsSummary).toBeDefined();
    expect(report.analytics.metricsSummary?.turns.min).toBe(8);
    expect(report.analytics.metricsSummary?.turns.max).toBe(14);
  });

  it("omits the Behaviour Metrics block when no result has metrics", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const report = createReport([makeProblemResult({ stages: [passing], passed: true })]);
    expect(formatReportTable(report)).not.toContain("Behaviour Metrics");
    expect(report.analytics.metricsSummary).toBeUndefined();
  });

  it("threads sdkBranch and iterationCount metadata onto the report", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const report = createReport([makeProblemResult({ stages: [passing], passed: true })], {
      sdkBranch: "feat/exec-description-required",
      iterationCount: 3,
    });
    expect(report.sdkBranch).toBe("feat/exec-description-required");
    expect(report.iterationCount).toBe(3);
  });

  it("omits sdkBranch when metadata does not provide it", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const report = createReport([makeProblemResult({ stages: [passing], passed: true })]);
    expect(report.sdkBranch).toBeUndefined();
    expect("sdkBranch" in report).toBe(false);
  });
});

describe("aggregateIterations", () => {
  const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
  const failing: StageResult = { stage: "tests", passed: false, output: "fail" };

  it("returns the input unchanged when a single iteration is supplied", () => {
    const single = makeProblemResult({ stages: [passing], passed: true });
    expect(aggregateIterations([single])).toBe(single);
  });

  it("throws when given an empty iteration list", () => {
    expect(() => aggregateIterations([])).toThrow(/empty input/);
  });

  it("computes passRate and behavioural-metric median/stdev across N iterations", () => {
    const iters: ProblemResult[] = [
      makeProblemResult({
        problemId: "m01",
        stages: [passing],
        passed: true,
        solveResult: { success: true, durationMs: 0, output: "" },
        metrics: mkMetrics({ turns: 10, readSdkDts: 2, readDocs: 1, bashRetries: 0 }),
      }),
      makeProblemResult({
        problemId: "m01",
        stages: [failing],
        passed: false,
        solveResult: { success: true, durationMs: 0, output: "" },
        metrics: mkMetrics({ turns: 14, readSdkDts: 3, readDocs: 1, bashRetries: 2 }),
      }),
      makeProblemResult({
        problemId: "m01",
        stages: [passing],
        passed: true,
        solveResult: { success: true, durationMs: 0, output: "" },
        metrics: mkMetrics({ turns: 12, readSdkDts: 4, readDocs: 1, bashRetries: 1 }),
      }),
    ];

    const agg = aggregateIterations(iters);
    expect(agg.iterations?.count).toBe(3);
    expect(agg.iterations?.passedCount).toBe(2);
    expect(agg.iterations?.passRate).toBeCloseTo(2 / 3, 10);
    expect(agg.iterations?.passedByIteration).toEqual([true, false, true]);
    // cost aggregation has been retired; legacy fields are now optional and
    // never written by the OSS runner.
    expect(agg.iterations?.costMedian).toBeUndefined();
    expect(agg.iterations?.costStdev).toBeUndefined();
    // turns: [10, 14, 12] median=12, mean=12, stdev=sqrt((4+4+0)/3)
    expect(agg.iterations?.metricsMedian.turns).toBe(12);
    expect(agg.iterations?.metricsStdev.turns).toBeCloseTo(Math.sqrt(8 / 3), 10);
  });

  it('marks aggregate "passed" true when any iteration passes', () => {
    const iters: ProblemResult[] = [
      makeProblemResult({ problemId: "m01", stages: [failing], passed: false }),
      makeProblemResult({ problemId: "m01", stages: [passing], passed: true }),
      makeProblemResult({ problemId: "m01", stages: [failing], passed: false }),
    ];
    const agg = aggregateIterations(iters);
    expect(agg.passed).toBe(true);
    expect(agg.iterations?.passedCount).toBe(1);
    expect(agg.iterations?.passRate).toBeCloseTo(1 / 3, 10);
  });

  it('marks aggregate "passed" false when every iteration fails', () => {
    const iters: ProblemResult[] = [
      makeProblemResult({ problemId: "m01", stages: [failing], passed: false }),
      makeProblemResult({ problemId: "m01", stages: [failing], passed: false }),
    ];
    const agg = aggregateIterations(iters);
    expect(agg.passed).toBe(false);
    expect(agg.iterations?.passRate).toBe(0);
  });

  it("preserves metadata from the first passing iteration (best wins)", () => {
    const iters: ProblemResult[] = [
      makeProblemResult({
        problemId: "m01",
        problemName: "iter0-name",
        stages: [failing],
        passed: false,
      }),
      makeProblemResult({
        problemId: "m01",
        problemName: "iter1-name",
        stages: [passing],
        passed: true,
      }),
    ];
    const agg = aggregateIterations(iters);
    // Best (passing) iteration is iter1; its metadata wins.
    expect(agg.problemName).toBe("iter1-name");
  });

  it("aggregates zero-metric iterations without crashing", () => {
    const iters: ProblemResult[] = [
      makeProblemResult({
        problemId: "m01",
        stages: [passing],
        passed: true,
        // intentionally no metrics
      }),
      makeProblemResult({ problemId: "m01", stages: [passing], passed: true }),
    ];
    const agg = aggregateIterations(iters);
    expect(agg.iterations?.metricsMedian.turns).toBe(0);
    expect(agg.iterations?.metricsStdev.turns).toBe(0);
  });
});

describe("formatReportTable (iterations)", () => {
  it("renders the iteration aggregate line when iterations.count > 1", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const result: ProblemResult = {
      problemId: "m01",
      problemName: "fixture",
      difficulty: "easy",
      category: "micro",
      stages: [passing],
      passed: true,
      iterations: {
        count: 3,
        passedCount: 2,
        passRate: 2 / 3,
        passedByIteration: [true, false, true],
        metricsMedian: {
          turns: 12,
          readSdkDts: 3,
          readDocs: 2,
          bashRetries: 4,
          "sdk-dts": 3,
          "sdk-package-src": 0,
          "sdk-docs": 2,
          "problem-files": 1,
          other: 0,
        },
        metricsStdev: {
          turns: 1.8,
          readSdkDts: 0.5,
          readDocs: 0,
          bashRetries: 2.1,
          "sdk-dts": 0.5,
          "sdk-package-src": 0,
          "sdk-docs": 0,
          "problem-files": 0,
          other: 0,
        },
      },
    };
    const report = createReport([result]);
    const table = formatReportTable(report);
    expect(table).toContain("iter pass=2/3 (67%)");
    expect(table).not.toContain("cost_median");
    expect(table).toContain("turns=12.0±1.8");
    expect(table).toContain("bash_retries=4.0±2.1");
  });

  it("omits the iteration aggregate line for single-iteration results", () => {
    const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
    const report = createReport([
      {
        problemId: "m01",
        problemName: "fixture",
        difficulty: "easy",
        category: "micro",
        stages: [passing],
        passed: true,
      },
    ]);
    expect(formatReportTable(report)).not.toContain("iter pass=");
  });
});

// T3: persistent failures section surfaces stable-fail problems (every
// iteration failed verification, solver completed) as SDK improvement
// candidates. Infra failures are tagged separately so analyzers can ignore
// them without losing the structured payload.
describe("persistent failures", () => {
  const passing: StageResult = { stage: "tests", passed: true, output: "ok" };
  const failing: StageResult = { stage: "tests", passed: false, output: "fail" };
  const infraStages: StageResult[] = [
    { stage: "generate", passed: false, output: "Skipped (infrastructure failure)" },
    { stage: "typecheck", passed: false, output: "Skipped (infrastructure failure)" },
    { stage: "tests", passed: false, output: "Skipped (infrastructure failure)" },
  ];

  it("collects passRate=0 multi-iteration results as stable_fail (single-iteration falls through to !passed)", () => {
    const report = createReport([
      // Multi-iteration: passRate === 0 with passedCount tracked.
      makeProblemResult({
        problemId: "m05",
        problemName: "db-type-hooks-create",
        stages: [failing],
        passed: false,
        iterations: {
          count: 3,
          passedCount: 0,
          passRate: 0,
          passedByIteration: [false, false, false],
          metricsMedian: {
            turns: 0,
            readSdkDts: 0,
            readDocs: 0,
            bashRetries: 0,
            "sdk-dts": 0,
            "sdk-package-src": 0,
            "sdk-docs": 0,
            "problem-files": 0,
            other: 0,
          },
          metricsStdev: {
            turns: 0,
            readSdkDts: 0,
            readDocs: 0,
            bashRetries: 0,
            "sdk-dts": 0,
            "sdk-package-src": 0,
            "sdk-docs": 0,
            "problem-files": 0,
            other: 0,
          },
        },
      }),
      // Single-iteration fail: no iterations field → falls back to !passed.
      makeProblemResult({
        problemId: "h12",
        problemName: "cli-cascade-error-batch-fix",
        stages: [failing],
        passed: false,
      }),
      // Passing problem: must not appear in persistentFailures.
      makeProblemResult({
        problemId: "h01",
        problemName: "tailordb-hooks-null-update-cascade",
        stages: [passing],
        passed: true,
      }),
    ]);

    expect(report.analytics.persistentFailures).toEqual([
      { problemId: "m05", reason: "stable_fail" },
      { problemId: "h12", reason: "stable_fail" },
    ]);
  });

  it("tags every-stage-infra-failure runs as infra_failure (not stable_fail)", () => {
    const report = createReport([
      makeProblemResult({
        problemId: "m24",
        problemName: "cli-retry-loop-detection",
        stages: infraStages,
        passed: false,
        solveResult: { success: false, durationMs: 0, output: "", infraFailure: true },
      }),
    ]);
    expect(report.analytics.persistentFailures).toEqual([
      { problemId: "m24", reason: "infra_failure" },
    ]);
  });

  it("renders only stable_fail entries in the Persistent failures section", () => {
    const report = createReport([
      // stable_fail entry — should render
      makeProblemResult({
        problemId: "m05",
        problemName: "db-type-hooks-create",
        stages: [failing],
        passed: false,
      }),
      // infra_failure entry — should NOT render in this section
      makeProblemResult({
        problemId: "m24",
        problemName: "cli-retry-loop-detection",
        stages: infraStages,
        passed: false,
        solveResult: { success: false, durationMs: 0, output: "", infraFailure: true },
      }),
    ]);

    const table = formatReportTable(report);
    expect(table).toContain("Persistent failures (SDK improvement candidates):");
    expect(table).toMatch(/Persistent failures[^]*m05/);
    // The infra failure is logged via the WARNING line above, not in the
    // SDK-improvement list.
    expect(table).not.toMatch(/Persistent failures[^]*m24/);
  });

  it("omits the Persistent failures section when no stable_fail entries exist", () => {
    const report = createReport([makeProblemResult({ stages: [passing], passed: true })]);
    expect(formatReportTable(report)).not.toContain("Persistent failures");
  });
});
