import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChallengeReport, IterationAggregate, ProblemResult } from "./report";
import {
  archiveProblemDir,
  GRADUATION_HISTORY_WINDOW,
  graduateProblems,
  isGraduationCandidate,
  loadRecentReports,
} from "./graduation";

function makeIterations(passRate: number, median: number, stdev: number): IterationAggregate {
  const passedCount = Math.round(passRate * 5);
  return {
    count: 5,
    passedCount,
    passRate,
    passedByIteration: Array.from({ length: 5 }, (_, i) => i < passedCount),
    metricsMedian: {
      turns: median,
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
      turns: stdev,
      readSdkDts: 0,
      readDocs: 0,
      bashRetries: 0,
      "sdk-dts": 0,
      "sdk-package-src": 0,
      "sdk-docs": 0,
      "problem-files": 0,
      other: 0,
    },
  };
}

function makeProblem(
  id: string,
  options: { passed?: boolean; iterations?: IterationAggregate } = {},
): ProblemResult {
  return {
    problemId: id,
    problemName: id,
    sdkSurface: "micro",
    stages: [],
    passed: options.passed ?? true,
    contextProfile: "code-only",
    ...(options.iterations ? { iterations: options.iterations } : {}),
  };
}

function makeReport(
  results: ProblemResult[],
  overrides: Partial<ChallengeReport> = {},
): ChallengeReport {
  return {
    timestamp: new Date().toISOString(),
    model: "codex-gpt-5.5-xhigh",
    contextProfile: "code-only",
    results,
    problemsPassed: results.filter((r) => r.passed).length,
    problemsTotal: results.length,
    percentage: 100,
    infraFailureCount: 0,
    validPercentage: 100,
    totalDurationMs: 0,
    analytics: { stagePassRates: {} },
    ...overrides,
  };
}

describe("isGraduationCandidate", () => {
  it("returns true for 5 consecutive passRate=1.0 reports with stable turns variance", () => {
    const reports = Array.from({ length: 5 }, () =>
      makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.5) })]),
    );
    expect(isGraduationCandidate(reports, "m01")).toBe(true);
  });

  it("returns false when fewer than the window's worth of reports exist", () => {
    const reports = Array.from({ length: GRADUATION_HISTORY_WINDOW - 1 }, () =>
      makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.1) })]),
    );
    expect(isGraduationCandidate(reports, "m01")).toBe(false);
  });

  it("returns false when one of the older reports has passRate < 1.0", () => {
    const reports = [
      makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.5) })]),
      makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.5) })]),
      makeReport([makeProblem("m01", { iterations: makeIterations(0.8, 10, 1) })]),
      makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.5) })]),
      makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.5) })]),
    ];
    expect(isGraduationCandidate(reports, "m01")).toBe(false);
  });

  it("falls back to the binary passed field for single-iteration reports", () => {
    const reports = [
      makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.5) })]),
      makeReport([makeProblem("m01", { passed: true })]),
      makeReport([makeProblem("m01", { passed: true })]),
      makeReport([makeProblem("m01", { passed: true })]),
      makeReport([makeProblem("m01", { passed: true })]),
    ];
    expect(isGraduationCandidate(reports, "m01")).toBe(true);
  });

  it("returns false when the problem is missing from any report", () => {
    const reports = [
      makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.5) })]),
      makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.5) })]),
      makeReport([]),
      makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.5) })]),
      makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.5) })]),
    ];
    expect(isGraduationCandidate(reports, "m01")).toBe(false);
  });

  it("returns false when the latest report's stdev/median exceeds the threshold", () => {
    const reports = [
      makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 2) })]),
      ...Array.from({ length: 4 }, () =>
        makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.5) })]),
      ),
    ];
    expect(isGraduationCandidate(reports, "m01")).toBe(false);
  });

  it("returns false when the latest report has no iteration data (variance gate fails)", () => {
    const reports = [
      makeReport([makeProblem("m01", { passed: true })]),
      ...Array.from({ length: 4 }, () =>
        makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.5) })]),
      ),
    ];
    expect(isGraduationCandidate(reports, "m01")).toBe(false);
  });

  it("returns false when the latest report's median turns is zero", () => {
    const reports = [
      makeReport([makeProblem("m01", { iterations: makeIterations(1, 0, 0) })]),
      ...Array.from({ length: 4 }, () =>
        makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.5) })]),
      ),
    ];
    expect(isGraduationCandidate(reports, "m01")).toBe(false);
  });
});

describe("archiveProblemDir + loadRecentReports + graduateProblems", () => {
  let tempRoot: string;
  let challengeRoot: string;
  let runResultsDir: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-graduation-test-"));
    challengeRoot = path.join(tempRoot, "challenge");
    runResultsDir = path.join(challengeRoot, "results", "model-code-only");
    fs.mkdirSync(path.join(challengeRoot, "problems"), { recursive: true });
    fs.mkdirSync(runResultsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  function writeProblem(dirName: string, meta: { id: string }): void {
    const dir = path.join(challengeRoot, "problems", dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
  }

  function writeHistoricalReport(runId: string, report: ChallengeReport): void {
    fs.writeFileSync(
      path.join(runResultsDir, `report-1.0.0-${runId}.json`),
      JSON.stringify(report),
    );
  }

  it("loadRecentReports returns newest-first by filename order", () => {
    writeHistoricalReport(
      "2026-05-10T00-00-00",
      makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.5) })]),
    );
    writeHistoricalReport(
      "2026-05-12T00-00-00",
      makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.4) })]),
    );
    writeHistoricalReport(
      "2026-05-11T00-00-00",
      makeReport([makeProblem("m01", { iterations: makeIterations(1, 10, 0.3) })]),
    );
    const reports = loadRecentReports(runResultsDir, 5);
    expect(reports.length).toBe(3);
    // Newest first — picked by lexical order of the embedded runId.
    expect(reports[0]!.results[0]!.iterations!.metricsStdev.turns).toBe(0.4);
    expect(reports[1]!.results[0]!.iterations!.metricsStdev.turns).toBe(0.3);
    expect(reports[2]!.results[0]!.iterations!.metricsStdev.turns).toBe(0.5);
  });

  it("archiveProblemDir moves problems/<id> to problems/archived/<id>", () => {
    writeProblem("m01-foo", { id: "m01-foo" });
    expect(archiveProblemDir(challengeRoot, "m01-foo")).toBe(true);
    expect(fs.existsSync(path.join(challengeRoot, "problems", "m01-foo"))).toBe(false);
    expect(fs.existsSync(path.join(challengeRoot, "problems", "archived", "m01-foo"))).toBe(true);
  });

  it("archiveProblemDir returns false when the destination already exists", () => {
    writeProblem("m01-foo", { id: "m01-foo" });
    fs.mkdirSync(path.join(challengeRoot, "problems", "archived", "m01-foo"), { recursive: true });
    expect(archiveProblemDir(challengeRoot, "m01-foo")).toBe(false);
  });

  it("graduateProblems no-ops outside the code-only profile", () => {
    writeProblem("m01-foo", { id: "m01-foo" });
    for (let i = 0; i < 5; i++) {
      writeHistoricalReport(
        `2026-05-${10 + i}T00-00-00`,
        makeReport([makeProblem("m01-foo", { iterations: makeIterations(1, 10, 0.4) })], {
          contextProfile: "code-and-docs",
        }),
      );
    }
    const latest = makeReport(
      [makeProblem("m01-foo", { iterations: makeIterations(1, 10, 0.4) })],
      { contextProfile: "code-and-docs" },
    );
    expect(
      graduateProblems({ runResultsDir, challengeRoot, latestReport: latest }).graduated,
    ).toEqual([]);
    expect(fs.existsSync(path.join(challengeRoot, "problems", "m01-foo"))).toBe(true);
  });

  it("graduateProblems no-ops when the run used --sdk-branch", () => {
    writeProblem("m01-foo", { id: "m01-foo" });
    for (let i = 0; i < 5; i++) {
      writeHistoricalReport(
        `2026-05-${10 + i}T00-00-00`,
        makeReport([makeProblem("m01-foo", { iterations: makeIterations(1, 10, 0.4) })]),
      );
    }
    const latest = makeReport(
      [makeProblem("m01-foo", { iterations: makeIterations(1, 10, 0.4) })],
      { sdkBranch: "feat/candidate" },
    );
    expect(
      graduateProblems({ runResultsDir, challengeRoot, latestReport: latest }).graduated,
    ).toEqual([]);
    expect(fs.existsSync(path.join(challengeRoot, "problems", "m01-foo"))).toBe(true);
  });

  it("graduateProblems archives a fully-passing problem after 5 consecutive reports", () => {
    writeProblem("m01-foo", { id: "m01-foo" });
    writeProblem("m02-flaky", { id: "m02-flaky" });
    for (let i = 0; i < 4; i++) {
      writeHistoricalReport(
        `2026-05-${10 + i}T00-00-00`,
        makeReport([
          makeProblem("m01-foo", { iterations: makeIterations(1, 10, 0.4) }),
          makeProblem("m02-flaky", { iterations: makeIterations(0.6, 12, 5) }),
        ]),
      );
    }
    const latest = makeReport([
      makeProblem("m01-foo", { iterations: makeIterations(1, 10, 0.4) }),
      makeProblem("m02-flaky", { iterations: makeIterations(0.8, 12, 5) }),
    ]);
    // The latest report itself must be visible to loadRecentReports.
    writeHistoricalReport("2026-05-14T00-00-00", latest);
    const outcome = graduateProblems({ runResultsDir, challengeRoot, latestReport: latest });
    expect(outcome.graduated).toEqual(["m01-foo"]);
    expect(fs.existsSync(path.join(challengeRoot, "problems", "m01-foo"))).toBe(false);
    expect(fs.existsSync(path.join(challengeRoot, "problems", "archived", "m01-foo"))).toBe(true);
    expect(fs.existsSync(path.join(challengeRoot, "problems", "m02-flaky"))).toBe(true);
  });
});
