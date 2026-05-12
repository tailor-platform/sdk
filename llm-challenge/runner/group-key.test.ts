import { describe, expect, it } from "vitest";
import { formatGroupKey, getGroupKey, groupKeyId } from "./group-key";
import type { ChallengeReport } from "./score";

function makeReport(overrides: Partial<ChallengeReport>): ChallengeReport {
  return {
    timestamp: "2025-01-01T00:00:00Z",
    sdkVersion: "0.0.0",
    runId: "test",
    elapsedMs: 0,
    results: [],
    summary: {
      totalProblems: 0,
      passed: 0,
      partial: 0,
      failed: 0,
      totalScore: 0,
      maxScore: 0,
      percentage: 0,
      adjustedScore: 0,
      adjustedPercentage: 0,
    },
    analytics: {
      failureDistribution: {},
      affordanceDistribution: {},
      stageSuccessRates: [],
      difficultySuccessRates: [],
      categorySuccessRates: [],
      apiSurfaceSuccessRates: [],
      problemSuccessRates: [],
      splitAggregates: {},
      retryAnalysis: {
        selfCorrectable: {},
        persistent: {},
      },
      suggestedApiRedesigns: [],
    },
    ...overrides,
  } as ChallengeReport;
}

describe("getGroupKey", () => {
  it("parses an agent:model label", () => {
    const report = makeReport({ model: "claude:opus", contextProfile: "types-only" });
    expect(getGroupKey(report)).toEqual({
      agent: "claude",
      model: "opus",
      contextProfile: "types-only",
    });
  });

  it("reduces a composite rerun label to the primary segment", () => {
    const report = makeReport({
      model: "claude:opus+codex:default",
      contextProfile: "full-package",
    });
    expect(getGroupKey(report)).toEqual({
      agent: "claude",
      model: "opus",
      contextProfile: "full-package",
    });
  });

  it("treats legacy model-only labels as the claude agent", () => {
    // Reports written before agent:model existed stored just "sonnet" / "opus".
    // Both group under claude so filters like --agent claude --model sonnet
    // can still find them.
    const report = makeReport({ model: "sonnet", contextProfile: "types-only" });
    expect(getGroupKey(report)).toEqual({
      agent: "claude",
      model: "sonnet",
      contextProfile: "types-only",
    });
  });

  it("groups solution-verify reports under a sentinel agent", () => {
    const report = makeReport({ model: undefined, contextProfile: "full-package" });
    expect(getGroupKey(report)).toEqual({
      agent: "solution",
      model: "verify",
      contextProfile: "full-package",
    });
  });

  it("falls back to unknown context profile when missing", () => {
    const report = makeReport({ model: "codex:default", contextProfile: undefined });
    expect(getGroupKey(report)).toEqual({
      agent: "codex",
      model: "default",
      contextProfile: "unknown",
    });
  });

  it("falls back to unknown when contextProfile is an empty string", () => {
    // Reports occasionally serialize `contextProfile: ""` rather than omitting it;
    // both should route to the sentinel so empty values do not create a distinct
    // "" bucket in analyze --groups.
    const report = makeReport({ model: "claude:opus", contextProfile: "" });
    expect(getGroupKey(report).contextProfile).toBe("unknown");
  });
});

describe("formatGroupKey", () => {
  it("renders agent:model and context profile separated by a slash", () => {
    expect(formatGroupKey({ agent: "claude", model: "opus", contextProfile: "types-only" })).toBe(
      "claude:opus / types-only",
    );
  });
});

describe("groupKeyId", () => {
  it("produces a pipe-joined identifier suitable for map keys", () => {
    expect(groupKeyId({ agent: "codex", model: "default", contextProfile: "full-package" })).toBe(
      "codex|default|full-package",
    );
  });

  it("distinguishes two groups that share an agent but differ in context profile", () => {
    const a = groupKeyId({ agent: "claude", model: "opus", contextProfile: "types-only" });
    const b = groupKeyId({ agent: "claude", model: "opus", contextProfile: "docs-only" });
    expect(a).not.toBe(b);
  });
});
