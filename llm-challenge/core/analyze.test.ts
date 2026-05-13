import { describe, expect, it } from "vitest";
import { computeReportDiff } from "./analyze";
import type { ChallengeReport, ProblemResult } from "./report";

/**
 * Build a minimal `ChallengeReport` for diff tests. Defaults mirror what
 * `createReport` produces in single-iteration mode; per-test overrides
 * customize the fields we care about.
 */
function makeReport(overrides: Partial<ChallengeReport> = {}): ChallengeReport {
  return {
    timestamp: "2026-05-13T00:00:00.000Z",
    results: [],
    problemsPassed: 0,
    problemsTotal: 0,
    percentage: 0,
    totalCostUsd: 0,
    infraFailureCount: 0,
    validPercentage: 0,
    totalDurationMs: 0,
    analytics: {
      stagePassRates: {},
    },
    ...overrides,
  };
}

function makeResult(
  problemId: string,
  passed: boolean,
  extra: Partial<ProblemResult> = {},
): ProblemResult {
  return {
    problemId,
    problemName: problemId,
    difficulty: "easy",
    category: "micro",
    stages: [{ stage: "tests", passed, output: passed ? "ok" : "fail" }],
    passed,
    ...extra,
  };
}

function makeIterResult(
  problemId: string,
  passRate: number,
  costMedian: number,
  extra: Partial<ProblemResult> = {},
): ProblemResult {
  const count = 3;
  const passedCount = Math.round(passRate * count);
  return makeResult(problemId, passedCount > 0, {
    iterations: {
      count,
      passedCount,
      passRate,
      passedByIteration: Array.from({ length: count }, (_, i) => i < passedCount),
      costMedian,
      costStdev: 0,
      metricsMedian: { turns: 10, readSdkDts: 3, readDocs: 1, bashRetries: 1 },
      metricsStdev: { turns: 0, readSdkDts: 0, readDocs: 0, bashRetries: 0 },
    },
    ...extra,
  });
}

describe("computeReportDiff", () => {
  it("returns zero deltas when both reports contain identical results", () => {
    const result = makeResult("m01", true);
    const reportA = makeReport({ results: [result] });
    const reportB = makeReport({ results: [result] });

    const diff = computeReportDiff(reportA, reportB);

    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0]!.problemKey).toBe("m01");
    expect(diff.rows[0]!.status).toBe("present");
    expect(diff.rows[0]!.passRateA).toBe(1);
    expect(diff.rows[0]!.passRateB).toBe(1);
    expect(diff.rows[0]!.passRateDelta).toBe(0);
    expect(diff.overallPassRateDelta).toBe(0);
  });

  it("computes positive delta when candidate improves pass rate", () => {
    const reportA = makeReport({
      results: [makeResult("m01", false), makeResult("m02", false)],
    });
    const reportB = makeReport({
      results: [makeResult("m01", true), makeResult("m02", true)],
    });

    const diff = computeReportDiff(reportA, reportB);

    expect(diff.rows).toHaveLength(2);
    expect(diff.rows.every((r) => r.passRateDelta === 1)).toBe(true);
    expect(diff.overallPassRateDelta).toBe(1);
  });

  it("normalizes single-iteration vs multi-iteration pass rates correctly", () => {
    // Single-iteration: pass = 1, fail = 0
    const reportA = makeReport({
      iterationCount: 1,
      results: [makeResult("m01", false)],
    });
    // Multi-iteration: 2/3 passed = 0.667
    const reportB = makeReport({
      iterationCount: 3,
      results: [makeIterResult("m01", 2 / 3, 0.1)],
    });

    const diff = computeReportDiff(reportA, reportB);
    expect(diff.rows[0]!.passRateA).toBe(0);
    expect(diff.rows[0]!.passRateB).toBeCloseTo(2 / 3, 10);
    expect(diff.rows[0]!.passRateDelta).toBeCloseTo(2 / 3, 10);
    // iterationCount differs — warning surfaced.
    expect(diff.warnings.some((w) => w.includes("iterationCount mismatch"))).toBe(true);
  });

  it('marks problems only in B as "added"', () => {
    const reportA = makeReport({ results: [makeResult("m01", true)] });
    const reportB = makeReport({
      results: [makeResult("m01", true), makeResult("m02", true)],
    });

    const diff = computeReportDiff(reportA, reportB);
    const added = diff.rows.find((r) => r.problemKey === "m02");
    expect(added?.status).toBe("added");
    expect(added?.passRateA).toBeNull();
    expect(added?.passRateB).toBe(1);
    expect(added?.passRateDelta).toBeNull();
  });

  it('marks problems only in A as "removed"', () => {
    const reportA = makeReport({
      results: [makeResult("m01", true), makeResult("m99", true)],
    });
    const reportB = makeReport({ results: [makeResult("m01", true)] });

    const diff = computeReportDiff(reportA, reportB);
    const removed = diff.rows.find((r) => r.problemKey === "m99");
    expect(removed?.status).toBe("removed");
    expect(removed?.passRateA).toBe(1);
    expect(removed?.passRateB).toBeNull();
    expect(removed?.passRateDelta).toBeNull();
  });

  it("excludes added/removed problems from overall pass-rate delta", () => {
    // Overlap: m01 (0 → 1), removed: m99 (was 1 in A), added: m03 (1 in B).
    // Only m01 should influence overallPassRateDelta = 1 - 0 = 1.
    const reportA = makeReport({
      results: [makeResult("m01", false), makeResult("m99", true)],
    });
    const reportB = makeReport({
      results: [makeResult("m01", true), makeResult("m03", true)],
    });
    const diff = computeReportDiff(reportA, reportB);
    expect(diff.overallPassRateDelta).toBe(1);
  });

  it("computes cost delta from iteration median when present", () => {
    const reportA = makeReport({
      iterationCount: 3,
      results: [makeIterResult("m01", 1, 0.1)],
    });
    const reportB = makeReport({
      iterationCount: 3,
      results: [makeIterResult("m01", 1, 0.3)],
    });
    const diff = computeReportDiff(reportA, reportB);
    expect(diff.rows[0]!.costMedianA).toBeCloseTo(0.1, 10);
    expect(diff.rows[0]!.costMedianB).toBeCloseTo(0.3, 10);
    expect(diff.rows[0]!.costMedianDelta).toBeCloseTo(0.2, 10);
    expect(diff.totalCostDelta).toBeCloseTo(0.2, 10);
  });

  it("surfaces a warning when context profile differs between reports", () => {
    const reportA = makeReport({ contextProfile: "types-only" });
    const reportB = makeReport({ contextProfile: "full-package" });
    const diff = computeReportDiff(reportA, reportB);
    expect(diff.warnings.some((w) => w.startsWith("contextProfile differs"))).toBe(true);
  });

  it("surfaces a warning when model labels differ between reports", () => {
    const reportA = makeReport({ model: "claude:sonnet" });
    const reportB = makeReport({ model: "codex:gpt-5-codex" });
    const diff = computeReportDiff(reportA, reportB);
    expect(diff.warnings.some((w) => w.startsWith("model differs"))).toBe(true);
  });

  it("preserves report metadata (sdkBranch, iterationCount) in the diff envelope", () => {
    const reportA = makeReport({
      iterationCount: 3,
      results: [makeIterResult("m01", 1, 0.1)],
    });
    const reportB = makeReport({
      iterationCount: 3,
      sdkBranch: "feat/exec-description-required",
      results: [makeIterResult("m01", 1, 0.1)],
    });
    const diff = computeReportDiff(reportA, reportB, { a: "/tmp/a.json", b: "/tmp/b.json" });

    expect(diff.reportA.path).toBe("/tmp/a.json");
    expect(diff.reportA.iterationCount).toBe(3);
    expect(diff.reportA.sdkBranch).toBeUndefined();
    expect(diff.reportB.path).toBe("/tmp/b.json");
    expect(diff.reportB.iterationCount).toBe(3);
    expect(diff.reportB.sdkBranch).toBe("feat/exec-description-required");
  });

  it("computes metrics delta from iteration median when present", () => {
    const reportA = makeReport({
      iterationCount: 3,
      results: [
        makeIterResult("m01", 1, 0.1, {
          iterations: {
            count: 3,
            passedCount: 3,
            passRate: 1,
            passedByIteration: [true, true, true],
            costMedian: 0.1,
            costStdev: 0,
            metricsMedian: { turns: 15, readSdkDts: 5, readDocs: 2, bashRetries: 3 },
            metricsStdev: { turns: 0, readSdkDts: 0, readDocs: 0, bashRetries: 0 },
          },
        }),
      ],
    });
    const reportB = makeReport({
      iterationCount: 3,
      results: [
        makeIterResult("m01", 1, 0.1, {
          iterations: {
            count: 3,
            passedCount: 3,
            passRate: 1,
            passedByIteration: [true, true, true],
            costMedian: 0.1,
            costStdev: 0,
            metricsMedian: { turns: 10, readSdkDts: 3, readDocs: 2, bashRetries: 1 },
            metricsStdev: { turns: 0, readSdkDts: 0, readDocs: 0, bashRetries: 0 },
          },
        }),
      ],
    });

    const diff = computeReportDiff(reportA, reportB);
    expect(diff.rows[0]!.metricsDelta.turns).toBe(-5);
    expect(diff.rows[0]!.metricsDelta.readSdkDts).toBe(-2);
    expect(diff.rows[0]!.metricsDelta.bashRetries).toBe(-2);
    expect(diff.rows[0]!.metricsDelta.readDocs).toBe(0);
  });

  it("falls back to single-iteration trace metrics when iterations block is absent", () => {
    const reportA = makeReport({
      results: [
        makeResult("m01", true, {
          metrics: { turns: 20, toolCallCounts: {}, readSdkDts: 5, readDocs: 2, bashRetries: 3 },
        }),
      ],
    });
    const reportB = makeReport({
      results: [
        makeResult("m01", true, {
          metrics: { turns: 10, toolCallCounts: {}, readSdkDts: 2, readDocs: 1, bashRetries: 1 },
        }),
      ],
    });

    const diff = computeReportDiff(reportA, reportB);
    expect(diff.rows[0]!.metricsDelta.turns).toBe(-10);
    expect(diff.rows[0]!.metricsDelta.readSdkDts).toBe(-3);
  });

  it("returns null metric delta when neither side has metrics", () => {
    const reportA = makeReport({ results: [makeResult("m01", true)] });
    const reportB = makeReport({ results: [makeResult("m01", true)] });
    const diff = computeReportDiff(reportA, reportB);
    expect(diff.rows[0]!.metricsDelta.turns).toBeNull();
    expect(diff.rows[0]!.metricsDelta.readSdkDts).toBeNull();
    expect(diff.rows[0]!.metricsDelta.readDocs).toBeNull();
    expect(diff.rows[0]!.metricsDelta.bashRetries).toBeNull();
  });
});
