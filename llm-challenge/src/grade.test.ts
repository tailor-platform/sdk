import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aroundEach, describe, expect, test } from "vitest";
import {
  buildCommandEvidence,
  decideRunGrade,
  parseGradeArgs,
  summarizeGrades,
  type RunGrade,
} from "./grade";
import {
  buildClaudeJudgeArgs,
  buildJudgeOutputSchema,
  evaluateJudgeOutput,
  prepareJudgeWorkspace,
} from "./judge";
import { discoverProblems } from "./problems";
import { loadRubric, parseRubric } from "./rubric";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDirs: string[] = [];

aroundEach(async (runTest) => {
  await runTest();
  const dirs = [...tempDirs];
  tempDirs.length = 0;
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llm-challenge-grade-test-"));
  tempDirs.push(dir);
  return dir;
}

const claims = [
  { id: "uses-wait", claim: "A job calls wait()." },
  { id: "has-resolver", claim: "A resolver resolves the wait point." },
];

describe("rubric", () => {
  test("parses a rubric with unique kebab-case claim ids", () => {
    expect(parseRubric(JSON.stringify({ schemaVersion: 1, claims }))).toEqual({
      schemaVersion: 1,
      claims,
    });
  });

  test.each([
    { name: "no claims", value: { schemaVersion: 1, claims: [] }, error: "at least one claim" },
    {
      name: "duplicate ids",
      value: { schemaVersion: 1, claims: [claims[0], claims[0]] },
      error: "duplicate claim id",
    },
    {
      name: "invalid id",
      value: { schemaVersion: 1, claims: [{ id: "Uses Wait", claim: "x" }] },
      error: "kebab-case",
    },
    {
      name: "unknown field",
      value: { schemaVersion: 1, claims: [{ ...claims[0], weight: 2 }] },
      error: "unknown field",
    },
    {
      name: "wrong version",
      value: { schemaVersion: 2, claims },
      error: "schemaVersion must be 1",
    },
  ])("rejects $name", ({ value, error }) => {
    expect(() => parseRubric(JSON.stringify(value))).toThrow(error);
  });

  test("every problem ships a valid rubric", async () => {
    const problems = await discoverProblems(packageRoot);

    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      const loaded = await loadRubric(problem);
      expect(loaded.rubric.claims.length, `${problem.group}/${problem.id}`).toBeGreaterThan(0);
      expect(loaded.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("judge workspace", () => {
  test("copies regular solver files and drops agent configuration, symlinks, and caches", async () => {
    const dir = await makeTempDir();
    const worktreePath = path.join(dir, "work");
    const judgeDir = path.join(dir, "judge");
    for (const relativePath of [
      "src/app.ts",
      "README.md",
      ".claude/settings.json",
      "nested/.claude/settings.local.json",
      "CLAUDE.md",
      "nested/CLAUDE.local.md",
      ".mcp.json",
      "node_modules/pkg/index.js",
      ".git/config",
      ".tailor/cache/state.json",
      ".tailor/plugin/out.ts",
    ]) {
      await fs.mkdir(path.dirname(path.join(worktreePath, relativePath)), { recursive: true });
      await fs.writeFile(path.join(worktreePath, relativePath), "content\n");
    }
    await fs.writeFile(path.join(dir, "outside.txt"), "secret\n");
    await fs.symlink(path.join(dir, "outside.txt"), path.join(worktreePath, "link.txt"));

    const prepared = await prepareJudgeWorkspace(worktreePath, judgeDir);

    expect(prepared.files).toEqual([".tailor/plugin/out.ts", "README.md", "src/app.ts"]);
    expect(prepared.omitted).toEqual(
      expect.arrayContaining([
        { path: ".claude/settings.json", reason: "agent configuration" },
        { path: "nested/.claude/settings.local.json", reason: "agent configuration" },
        { path: "CLAUDE.md", reason: "agent configuration" },
        { path: "nested/CLAUDE.local.md", reason: "agent configuration" },
        { path: ".mcp.json", reason: "agent configuration" },
        { path: "link.txt", reason: "not a regular file" },
      ]),
    );
    await expect(fs.readFile(path.join(judgeDir, "src/app.ts"), "utf8")).resolves.toBe("content\n");
    await expect(fs.lstat(path.join(judgeDir, ".claude"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.lstat(path.join(judgeDir, "link.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("judge command", () => {
  test("runs the judge read-only with customizations disabled", () => {
    const args = buildClaudeJudgeArgs({
      model: "claude-opus-5-5",
      effort: "high",
      schema: buildJudgeOutputSchema(claims.map((claim) => claim.id)),
    });

    expect(args).toEqual(
      expect.arrayContaining(["--safe-mode", "--restricted", "--strict-mcp-config"]),
    );
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-5-5");
    expect(args).not.toContain("bypassPermissions");
    const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]) as {
      properties: { claims: { items: { properties: { id: { enum: string[] } } } } };
    };
    expect(schema.properties.claims.items.properties.id.enum).toEqual([
      "uses-wait",
      "has-resolver",
    ]);
  });
});

describe("judge output", () => {
  async function evaluate(structuredOutput: unknown, servedModel = "claude-opus-5-5") {
    const dir = await makeTempDir();
    const workspaceDir = path.join(dir, "workspace");
    const evidenceDir = path.join(dir, "evidence");
    await fs.mkdir(path.join(workspaceDir, "workflows"), { recursive: true });
    await fs.mkdir(evidenceDir, { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "workflows/approval.ts"),
      "const result = await approval.wait({\n  orderId,\n});\n",
    );
    await fs.writeFile(
      path.join(evidenceDir, "commands.json"),
      '[{"command":"tailor generate"}]\n',
    );
    await fs.writeFile(path.join(dir, "outside.ts"), "approval.resolve(id)\n");
    return await evaluateJudgeOutput({
      events: [
        {
          type: "assistant",
          parent_tool_use_id: null,
          message: { model: servedModel, content: [] },
        },
        {
          type: "result",
          subtype: "success",
          is_error: false,
          total_cost_usd: 0.5,
          structured_output: structuredOutput,
        },
      ],
      claims,
      judgeModel: "claude-opus-5-5",
      workspaceDir,
      evidenceDir,
    });
  }

  test("accepts verdicts whose evidence quotes exist in the workspace", async () => {
    const evaluation = await evaluate({
      claims: [
        {
          id: "uses-wait",
          verdict: "satisfied",
          reason: "wait is called",
          evidence: [{ path: "workflows/approval.ts", quote: "await approval.wait({ orderId," }],
        },
        {
          id: "has-resolver",
          verdict: "unsatisfied",
          reason: "no resolver",
          evidence: [{ path: "/evidence/commands.json", quote: "tailor generate" }],
        },
      ],
    });

    expect(evaluation).toMatchObject({
      status: "ok",
      costUsd: 0.5,
      claims: [
        { id: "uses-wait", verdict: "satisfied", counted: "satisfied" },
        { id: "has-resolver", verdict: "unsatisfied", counted: "unsatisfied" },
      ],
    });
  });

  test("does not count satisfied verdicts without verifiable evidence", async () => {
    const evaluation = await evaluate({
      claims: [
        {
          id: "uses-wait",
          verdict: "satisfied",
          reason: "made up",
          evidence: [{ path: "workflows/approval.ts", quote: "approval.resolve(id)" }],
        },
        {
          id: "has-resolver",
          verdict: "satisfied",
          reason: "outside",
          evidence: [{ path: "../outside.ts", quote: "approval.resolve(id)" }],
        },
      ],
    });

    expect(evaluation).toMatchObject({
      status: "ok",
      claims: [
        { id: "uses-wait", verdict: "satisfied", counted: "unsatisfied" },
        { id: "has-resolver", verdict: "satisfied", counted: "unsatisfied" },
      ],
    });
  });

  test.each([
    {
      name: "a missing claim",
      output: { claims: [{ id: "uses-wait", verdict: "unclear", reason: "", evidence: [] }] },
      error: "missing verdicts for has-resolver",
    },
    {
      name: "a duplicated claim",
      output: {
        claims: [
          { id: "uses-wait", verdict: "unclear", reason: "", evidence: [] },
          { id: "uses-wait", verdict: "unclear", reason: "", evidence: [] },
          { id: "has-resolver", verdict: "unclear", reason: "", evidence: [] },
        ],
      },
      error: "duplicate verdict for uses-wait",
    },
    { name: "no structured output", output: undefined, error: "no structured output" },
  ])("rejects $name", async ({ output, error }) => {
    await expect(evaluate(output)).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining(error),
    });
  });

  test("rejects output served by a different model", async () => {
    await expect(evaluate({ claims: [] }, "claude-sonnet-5-5")).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("claude-sonnet-5-5"),
    });
  });
});

describe("command evidence", () => {
  test("includes Claude command output tails from the trace", async () => {
    const dir = await makeTempDir();
    const tracePath = path.join(dir, "trace.jsonl");
    await fs.copyFile(
      path.join(packageRoot, "src/fixtures/claude-stream-failing-command.jsonl"),
      tracePath,
    );

    await expect(
      buildCommandEvidence({
        agent: "claude",
        tracePath,
        artifactSummaryPath: path.join(dir, "missing.json"),
      }),
    ).resolves.toEqual([
      {
        command: 'sh -c "echo out; echo err >&2; exit 3"',
        exitCode: 3,
        status: "failed",
        outputTail: "Exit code 3\nout\nerr",
      },
      { command: "echo fine", exitCode: 0, status: "completed", outputTail: "fine" },
    ]);
  });

  test("falls back to the artifact summary for Codex runs", async () => {
    const dir = await makeTempDir();
    const artifactSummaryPath = path.join(dir, "artifact-summary.json");
    await fs.writeFile(
      artifactSummaryPath,
      JSON.stringify({
        commands: [
          { command: "pnpm build", exitCode: 1, status: "failed" },
          { command: "pnpm test", exitCode: 0, status: "completed" },
        ],
        failedCommands: [{ command: "pnpm build", exitCode: 1, outputTail: "boom" }],
      }),
    );

    await expect(
      buildCommandEvidence({
        agent: "codex",
        tracePath: path.join(dir, "trace.jsonl"),
        artifactSummaryPath,
      }),
    ).resolves.toEqual([
      { command: "pnpm build", exitCode: 1, status: "failed", outputTail: "boom" },
      { command: "pnpm test", exitCode: 0, status: "completed" },
    ]);
  });
});

describe("run grade", () => {
  const okClaims = [
    {
      id: "a",
      claim: "A",
      verdict: "satisfied" as const,
      counted: "satisfied" as const,
      reason: "",
      evidence: [],
    },
    {
      id: "b",
      claim: "B",
      verdict: "satisfied" as const,
      counted: "satisfied" as const,
      reason: "",
      evidence: [],
    },
  ];

  test("passes only when the solver finished, common checks hold, and every claim is satisfied", () => {
    expect(
      decideRunGrade({
        failureKind: "none",
        checks: [
          { scope: "common", outcome: "satisfied" },
          { scope: "common", outcome: "skipped" },
          { scope: "problem", outcome: "unsatisfied" },
        ],
        judge: { status: "ok", claims: okClaims },
      }),
    ).toMatchObject({ status: "ok", metrics: { pass: 1, claimRate: 1, commonChecks: 1 } });

    expect(
      decideRunGrade({
        failureKind: "solver-nonzero",
        checks: [{ scope: "common", outcome: "satisfied" }],
        judge: { status: "ok", claims: okClaims },
      }),
    ).toMatchObject({ status: "ok", metrics: { pass: 0, claimRate: 1 } });

    expect(
      decideRunGrade({
        failureKind: "none",
        checks: [{ scope: "common", outcome: "unsatisfied" }],
        judge: {
          status: "ok",
          claims: [okClaims[0], { ...okClaims[1], counted: "unsatisfied" }],
        },
      }),
    ).toMatchObject({ status: "ok", metrics: { pass: 0, claimRate: 0.5, commonChecks: 0 } });
  });

  test("excludes infrastructure failures and reports verifier or judge errors", () => {
    expect(
      decideRunGrade({ failureKind: "usage-limit", checks: [], judge: undefined }),
    ).toMatchObject({ status: "excluded", reason: "solver usage-limit" });
    expect(
      decideRunGrade({
        failureKind: "none",
        checks: [{ scope: "common", outcome: "error" }],
        judge: undefined,
      }),
    ).toMatchObject({ status: "error", reason: "verification error" });
    expect(
      decideRunGrade({
        failureKind: "none",
        checks: [{ scope: "common", outcome: "satisfied" }],
        judge: { status: "error", error: "judge timed out" },
      }),
    ).toMatchObject({ status: "error", reason: "judge timed out" });
  });
});

describe("grade summary", () => {
  function grade(problemId: string, pass: 0 | 1, status: RunGrade["status"] = "ok"): RunGrade {
    return {
      problemId,
      group: "sdk-api",
      runIndex: 0,
      artifactDir: `results/x/${problemId}`,
      status,
      metrics: status === "ok" ? { pass, claimRate: pass, commonChecks: 1 } : undefined,
    };
  }

  test("macro-averages problems and bootstraps a deterministic interval", () => {
    const grades = [
      grade("a", 1),
      grade("a", 1),
      grade("a", 0),
      grade("b", 0),
      grade("b", 0),
      grade("b", 0, "excluded"),
      grade("c", 1, "error"),
    ];

    const first = summarizeGrades(grades, { seed: 7, iterations: 500 });
    const second = summarizeGrades(grades, { seed: 7, iterations: 500 });

    expect(first.overall.passRate).toBeCloseTo((2 / 3 + 0) / 2);
    expect(first.overall.scoredRuns).toBe(5);
    expect(first.overall.excludedRuns).toBe(1);
    expect(first.overall.errorRuns).toBe(1);
    expect(
      first.problems.map((problem) => [problem.problemId, problem.scoredRuns, problem.passes]),
    ).toEqual([
      ["a", 3, 2],
      ["b", 2, 0],
      ["c", 0, 0],
    ]);
    expect(first.overall.ci95).toEqual(second.overall.ci95);
    expect(first.overall.ci95[0]).toBeLessThanOrEqual(first.overall.passRate);
    expect(first.overall.ci95[1]).toBeGreaterThanOrEqual(first.overall.passRate);
  });
});

describe("grade arguments", () => {
  test("parses reports, judge settings, and defaults", () => {
    expect(parseGradeArgs(["--report", "results/a/report.json"])).toMatchObject({
      reports: ["results/a/report.json"],
      judgeModel: "claude-opus-5-5",
      judgeEffort: "high",
      concurrency: 1,
      allowSelfJudge: false,
    });
    expect(
      parseGradeArgs([
        "--report=a.json",
        "--report",
        "b.json",
        "--judge-model",
        "claude-fable-5-1",
        "--concurrency",
        "2",
        "--allow-self-judge",
      ]),
    ).toMatchObject({
      reports: ["a.json", "b.json"],
      judgeModel: "claude-fable-5-1",
      concurrency: 2,
      allowSelfJudge: true,
    });
    expect(() => parseGradeArgs([])).toThrow("--report is required");
  });
});
