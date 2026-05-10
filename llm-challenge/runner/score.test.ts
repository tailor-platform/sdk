import { describe, expect, it } from "vitest";
import type { ProblemMeta } from "../shared/helpers";
import { calculateScore } from "./score";

const baseMeta: ProblemMeta = {
  id: "999",
  name: "score-fixture",
  difficulty: "easy",
  category: "api-design",
  scoring: { generate: 10, typecheck: 10, tests: 10 },
  files: { implement: ["x.ts"], scaffold: [] },
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
});
