import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAliasMap,
  canonicalProblemId,
  computeReportDiff,
  resolveActiveProfilePair,
} from "./analyze";
import type { ReadTargetClass, TraceMetrics } from "./metrics";
import type { ChallengeReport, IterationAggregate, ProblemResult } from "./report";

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

/**
 * Helper: build an IterationAggregate metricsMedian/Stdev object. Defaults
 * every readTargets bucket to 0; pass the legacy fields and any per-bucket
 * overrides as needed.
 */
function mkIterMetrics(
  partial: Partial<IterationAggregate["metricsMedian"]>,
): IterationAggregate["metricsMedian"] {
  return {
    turns: 0,
    readSdkDts: 0,
    readDocs: 0,
    bashRetries: 0,
    "sdk-dts": 0,
    "sdk-package-src": 0,
    "sdk-docs": 0,
    "problem-files": 0,
    other: 0,
    ...partial,
  };
}

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
      metricsMedian: mkIterMetrics({ turns: 10, readSdkDts: 3, readDocs: 1, bashRetries: 1 }),
      metricsStdev: mkIterMetrics({}),
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
            metricsMedian: mkIterMetrics({ turns: 15, readSdkDts: 5, readDocs: 2, bashRetries: 3 }),
            metricsStdev: mkIterMetrics({}),
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
            metricsMedian: mkIterMetrics({ turns: 10, readSdkDts: 3, readDocs: 2, bashRetries: 1 }),
            metricsStdev: mkIterMetrics({}),
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
          metrics: mkMetrics({ turns: 20, readSdkDts: 5, readDocs: 2, bashRetries: 3 }),
        }),
      ],
    });
    const reportB = makeReport({
      results: [
        makeResult("m01", true, {
          metrics: mkMetrics({ turns: 10, readSdkDts: 2, readDocs: 1, bashRetries: 1 }),
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

  it("computes per-bucket readTargets deltas when iteration medians have per-class fields", () => {
    const reportA = makeReport({
      iterationCount: 3,
      results: [
        makeIterResult("m05", 1, 0.1, {
          iterations: {
            count: 3,
            passedCount: 3,
            passRate: 1,
            passedByIteration: [true, true, true],
            costMedian: 0.1,
            costStdev: 0,
            // types-only: read sdk-docs once, no sdk-dts.
            metricsMedian: mkIterMetrics({
              turns: 21,
              readSdkDts: 0,
              readDocs: 0,
              "sdk-dts": 0,
              "sdk-docs": 0,
              "problem-files": 2,
            }),
            metricsStdev: mkIterMetrics({ turns: 1.7 }),
          },
        }),
      ],
    });
    const reportB = makeReport({
      iterationCount: 3,
      results: [
        makeIterResult("m05", 1 / 3, 0.05, {
          iterations: {
            count: 3,
            passedCount: 1,
            passRate: 1 / 3,
            passedByIteration: [true, false, false],
            costMedian: 0.05,
            costStdev: 0,
            // full-package: agent now reads sdk-docs and pokes around problem-files.
            metricsMedian: mkIterMetrics({
              turns: 10,
              readSdkDts: 0,
              readDocs: 1,
              "sdk-dts": 0,
              "sdk-docs": 1,
              "problem-files": 5,
            }),
            metricsStdev: mkIterMetrics({ turns: 3.7 }),
          },
        }),
      ],
    });

    const diff = computeReportDiff(reportA, reportB);
    expect(diff.rows[0]!.readDeltas["sdk-dts"]).toBe(0);
    expect(diff.rows[0]!.readDeltas["sdk-docs"]).toBe(1);
    expect(diff.rows[0]!.readDeltas["problem-files"]).toBe(3);
    expect(diff.rows[0]!.stdevTurnsA).toBeCloseTo(1.7, 10);
    expect(diff.rows[0]!.stdevTurnsB).toBeCloseTo(3.7, 10);
  });

  it("falls back to legacy readSdkDts/readDocs when per-bucket fields are absent", () => {
    // Pre-Phase-5b reports stored only the legacy aggregates. The diff must
    // still surface a meaningful sdk-dts / sdk-docs delta so historical
    // comparisons keep working — Phase 5c calls this fallback path.
    const reportA = makeReport({
      results: [
        makeResult("m18", true, {
          metrics: {
            turns: 40,
            toolCallCounts: {},
            readTargets: {
              "sdk-dts": 0,
              "sdk-package-src": 0,
              "sdk-docs": 0,
              "problem-files": 0,
              other: 0,
            },
            readSdkDts: 0,
            readDocs: 0,
            bashRetries: 2,
          },
        }),
      ],
    });
    const reportB = makeReport({
      results: [
        makeResult("m18", false, {
          metrics: {
            turns: 43,
            toolCallCounts: {},
            readTargets: {
              "sdk-dts": 0,
              "sdk-package-src": 0,
              "sdk-docs": 0,
              "problem-files": 0,
              other: 0,
            },
            readSdkDts: 0,
            readDocs: 3,
            bashRetries: 4,
          },
        }),
      ],
    });
    const diff = computeReportDiff(reportA, reportB);
    // sdk-docs delta comes through the readTargets map (= 0 directly), but
    // the legacy field fallback only kicks in when readTargets is absent.
    expect(diff.rows[0]!.readDeltas["sdk-docs"]).toBe(0);
    // Drop readTargets entirely on side B and the legacy field should fill in:
    const reportC = makeReport({
      results: [
        makeResult("m18", true, {
          metrics: mkMetrics({ readDocs: 0 }),
        }),
      ],
    });
    const reportD = makeReport({
      results: [
        makeResult("m18", false, {
          // No readTargets map — emulating a legacy report on disk.
          metrics: {
            turns: 43,
            toolCallCounts: {},
            readTargets: undefined as unknown as TraceMetrics["readTargets"],
            readSdkDts: 0,
            readDocs: 3,
            bashRetries: 4,
          },
        }),
      ],
    });
    const diff2 = computeReportDiff(reportC, reportD);
    expect(diff2.rows[0]!.readDeltas["sdk-docs"]).toBe(3);
  });

  it("captures stdevTurnsA/B from iteration metrics", () => {
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
            metricsMedian: mkIterMetrics({ turns: 15 }),
            metricsStdev: mkIterMetrics({ turns: 2.5 }),
          },
        }),
      ],
    });
    const reportB = makeReport({
      results: [makeResult("m01", true)],
    });
    const diff = computeReportDiff(reportA, reportB);
    expect(diff.rows[0]!.stdevTurnsA).toBeCloseTo(2.5, 10);
    // reportB is single-iteration: no stdev available.
    expect(diff.rows[0]!.stdevTurnsB).toBeNull();
  });
});

describe("resolveActiveProfilePair", () => {
  function makeProfileReport(
    profile: "types-only" | "full-package",
    timestamp: string,
    overrides: Partial<ChallengeReport> = {},
  ): ChallengeReport {
    return {
      timestamp,
      model: "claude:sonnet",
      contextProfile: profile,
      results: [],
      problemsPassed: 0,
      problemsTotal: 0,
      percentage: 0,
      totalCostUsd: 0,
      infraFailureCount: 0,
      validPercentage: 0,
      totalDurationMs: 0,
      analytics: { stagePassRates: {} },
      ...overrides,
    };
  }

  it("returns the latest report per profile within the most-recent complete group", () => {
    const typesOnlyOld = makeProfileReport("types-only", "2026-05-13T06:00:00Z");
    const typesOnlyNew = makeProfileReport("types-only", "2026-05-13T07:00:00Z");
    const fullPackage = makeProfileReport("full-package", "2026-05-13T07:30:00Z");
    const result = resolveActiveProfilePair([typesOnlyOld, typesOnlyNew, fullPackage]);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.typesOnly.report.timestamp).toBe("2026-05-13T07:00:00Z");
      expect(result.fullPackage.report.timestamp).toBe("2026-05-13T07:30:00Z");
    }
  });

  it("prefers the report with more results when timestamps differ", () => {
    // Single-problem reruns should not displace the full sweep that happened
    // earlier — the diff is more meaningful when both sides cover the same
    // problem set.
    const fullSweep = makeProfileReport("full-package", "2026-05-13T07:30:00Z", {
      results: Array.from({ length: 25 }, (_, i) => ({
        problemId: `m${String(i + 1).padStart(2, "0")}`,
        problemName: `m${String(i + 1).padStart(2, "0")}`,
        difficulty: "easy",
        category: "micro",
        stages: [],
        passed: true,
      })),
    });
    const singleProblem = makeProfileReport("full-package", "2026-05-13T14:00:00Z", {
      results: [
        {
          problemId: "m18",
          problemName: "m18",
          difficulty: "easy",
          category: "micro",
          stages: [],
          passed: true,
        },
      ],
    });
    const typesOnly = makeProfileReport("types-only", "2026-05-13T07:00:00Z");
    const result = resolveActiveProfilePair([fullSweep, singleProblem, typesOnly]);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.fullPackage.report.timestamp).toBe("2026-05-13T07:30:00Z");
      expect(result.fullPackage.report.results.length).toBe(25);
    }
  });

  it("returns missing when only one profile has reports for the active group", () => {
    const typesOnly = makeProfileReport("types-only", "2026-05-13T06:00:00Z");
    const result = resolveActiveProfilePair([typesOnly]);
    expect(result.kind).toBe("missing");
    if (result.kind === "missing") {
      expect(result.reason).toMatch(/full-package/);
    }
  });

  it("excludes reports with sdkBranch set (those are A/B candidate runs)", () => {
    const typesOnly = makeProfileReport("types-only", "2026-05-13T07:00:00Z");
    const fullPackage = makeProfileReport("full-package", "2026-05-13T07:30:00Z");
    // Newer report but with sdkBranch — should be filtered out.
    const candidate = makeProfileReport("full-package", "2026-05-13T14:00:00Z", {
      sdkBranch: "feat/some-experiment",
    });
    const result = resolveActiveProfilePair([typesOnly, fullPackage, candidate]);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.fullPackage.report.timestamp).toBe("2026-05-13T07:30:00Z");
    }
  });

  it("returns missing on an empty input", () => {
    const result = resolveActiveProfilePair([]);
    expect(result.kind).toBe("missing");
  });
});

describe("buildAliasMap / canonicalProblemId", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-alias-test-"));
    fs.mkdirSync(path.join(tempRoot, "problems"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const writeProblem = (dirName: string, meta: { id: string; aliases?: string[] }): void => {
    const dir = path.join(tempRoot, "problems", dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
  };

  it("maps each alias to the canonical id of the problem that owns it", () => {
    writeProblem("m22-new", { id: "m22-new", aliases: ["m22-old"] });
    writeProblem("h13-renamed", { id: "h13-renamed", aliases: ["h13-shadow", "h13-shadowed"] });
    const map = buildAliasMap(tempRoot);
    expect(map.get("m22-old")).toBe("m22-new");
    expect(map.get("h13-shadow")).toBe("h13-renamed");
    expect(map.get("h13-shadowed")).toBe("h13-renamed");
  });

  it("skips problem dirs without meta.json or with malformed JSON", () => {
    writeProblem("m01", { id: "m01" });
    fs.mkdirSync(path.join(tempRoot, "problems", "no-meta"), { recursive: true });
    const badDir = path.join(tempRoot, "problems", "bad-meta");
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, "meta.json"), "{not json");
    // Should not throw, and m01 should still load (no aliases declared).
    const map = buildAliasMap(tempRoot);
    expect(map.size).toBe(0);
  });

  it("canonicalProblemId returns the alias target when present, original otherwise", () => {
    const map = new Map([["m22-old", "m22-new"]]);
    expect(canonicalProblemId("m22-old", map)).toBe("m22-new");
    expect(canonicalProblemId("h01", map)).toBe("h01");
  });
});
