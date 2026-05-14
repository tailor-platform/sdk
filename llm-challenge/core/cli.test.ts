import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { problemKey } from "../shared/helpers";
import {
  applyScaffoldLayers,
  cleanupWorktree,
  deriveProblemName,
  emitFailVsSolutionDiff,
  emitIterDiff,
  packSdkFromRef,
  shouldAutoExtend,
  shouldEarlyStop,
} from "./cli";
import type { ProblemResult, StageResult } from "./report";

describe("applyScaffoldLayers", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-scaffold-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("overlays a later layer's file on top of an earlier layer's file", () => {
    const shared = path.join(tempDir, "shared");
    const problem = path.join(tempDir, "problem");
    const workDir = path.join(tempDir, "work");
    fs.mkdirSync(shared, { recursive: true });
    fs.mkdirSync(problem, { recursive: true });
    fs.writeFileSync(path.join(shared, "a.ts"), "shared\n");
    fs.writeFileSync(path.join(problem, "a.ts"), "problem\n");

    applyScaffoldLayers(workDir, [shared, problem]);

    expect(fs.readFileSync(path.join(workDir, "a.ts"), "utf-8")).toBe("problem\n");
  });

  it("keeps shared-only files when the later layer does not provide them", () => {
    const shared = path.join(tempDir, "shared");
    const problem = path.join(tempDir, "problem");
    const workDir = path.join(tempDir, "work");
    fs.mkdirSync(shared, { recursive: true });
    fs.mkdirSync(problem, { recursive: true });
    fs.writeFileSync(path.join(shared, "only-shared.ts"), "shared\n");
    fs.writeFileSync(path.join(problem, "only-problem.ts"), "problem\n");

    applyScaffoldLayers(workDir, [shared, problem]);

    expect(fs.readFileSync(path.join(workDir, "only-shared.ts"), "utf-8")).toBe("shared\n");
    expect(fs.readFileSync(path.join(workDir, "only-problem.ts"), "utf-8")).toBe("problem\n");
  });

  it("recursively merges files inside subdirectories", () => {
    const shared = path.join(tempDir, "shared");
    const problem = path.join(tempDir, "problem");
    const workDir = path.join(tempDir, "work");
    fs.mkdirSync(path.join(shared, "tailordb"), { recursive: true });
    fs.mkdirSync(path.join(problem, "tailordb"), { recursive: true });
    fs.writeFileSync(path.join(shared, "tailordb", "shared.ts"), "shared\n");
    fs.writeFileSync(path.join(problem, "tailordb", "problem.ts"), "problem\n");

    applyScaffoldLayers(workDir, [shared, problem]);

    expect(fs.readFileSync(path.join(workDir, "tailordb", "shared.ts"), "utf-8")).toBe("shared\n");
    expect(fs.readFileSync(path.join(workDir, "tailordb", "problem.ts"), "utf-8")).toBe(
      "problem\n",
    );
  });

  it("silently skips layers whose source directory does not exist", () => {
    const shared = path.join(tempDir, "shared");
    const missing = path.join(tempDir, "does-not-exist");
    const workDir = path.join(tempDir, "work");
    fs.mkdirSync(shared, { recursive: true });
    fs.writeFileSync(path.join(shared, "a.ts"), "shared\n");

    applyScaffoldLayers(workDir, [shared, missing]);

    expect(fs.readFileSync(path.join(workDir, "a.ts"), "utf-8")).toBe("shared\n");
  });
});

describe("deriveProblemName", () => {
  it("returns meta.name when present", () => {
    expect(deriveProblemName({ id: "m01", name: "explicit" }, "m01-something")).toBe("explicit");
  });

  it("strips the `<id>-` prefix from the directory name when meta.name is missing", () => {
    expect(deriveProblemName({ id: "m01" }, "m01-db-field-unique-required")).toBe(
      "db-field-unique-required",
    );
  });

  it("falls back to the directory name when it does not start with the id prefix", () => {
    expect(deriveProblemName({ id: "m99" }, "unrelated-dir")).toBe("unrelated-dir");
  });
});

describe("problemKey", () => {
  it("joins legacy id and name with a dash", () => {
    expect(problemKey("002", "tailordb-api-design")).toBe("002-tailordb-api-design");
  });

  it("collapses to the id when the name is already a suffix of the id", () => {
    // Phase 2 micro-problem IDs embed the slug, so `<id>-<slug>` would duplicate it.
    expect(problemKey("m01-db-field-unique-required", "db-field-unique-required")).toBe(
      "m01-db-field-unique-required",
    );
  });

  it("returns the id alone when the name is empty", () => {
    expect(problemKey("m01-db-field-unique-required", "")).toBe("m01-db-field-unique-required");
  });
});

describe("packSdkFromRef", () => {
  // We do not exercise the happy path (it would run `git worktree add` + `pnpm
  // pack` against the real repo, which is forbidden by the Phase 4 plan
  // constraints — see Phase 4 Task #12 verification section). Instead we
  // assert the error-surface contract: a bogus ref must fail fast with a
  // recognizable message, before we get anywhere near `git worktree add`.
  it("throws a clear error when the ref does not exist", () => {
    const bogusRef = "definitely-not-a-real-ref-llm-challenge-test-12345";
    expect(() => packSdkFromRef(bogusRef)).toThrow(
      new RegExp(`\\[sdk-branch\\] Ref "${bogusRef}" not found`),
    );
  });
});

describe("cleanupWorktree", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-cleanup-test-"));
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Pure unit test: cleanupWorktree must be a no-op when the target path does
  // not exist. This is the post-error cleanup path (worktree add failed mid-
  // setup, so the dir was already removed); calling cleanupWorktree must not
  // throw.
  it("is a no-op when the worktree directory has already been removed", () => {
    const missing = path.join(tempDir, "missing-worktree");
    expect(() => cleanupWorktree(tempDir, missing)).not.toThrow();
  });
});

describe("emitIterDiff", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-iterdiff-test-"));
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function makeIteration(
    label: string,
    passed: boolean,
    workContent: string,
  ): { result: ProblemResult; workDir: string } {
    const artifactDir = path.join(tempDir, label);
    const workDir = path.join(artifactDir, "attempt-0", "work");
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, "tailor.config.ts"), workContent);
    const result: ProblemResult = {
      problemId: "m05-db-type-hooks-create",
      problemName: "db-type-hooks-create",
      difficulty: "easy",
      category: "micro",
      stages: [{ stage: "tests", passed, output: passed ? "ok" : "fail" }],
      passed,
      artifacts: { directory: artifactDir },
    };
    return { result, workDir };
  }

  it("writes a diff file when failing and passing iterations have different work trees", () => {
    const { result: failing, workDir: failingWork } = makeIteration(
      "iter-0",
      false,
      "// hook missing\n",
    );
    const { result: passing, workDir: passingWork } = makeIteration(
      "iter-2",
      true,
      "// hook missing\nexport const onCreate = () => {};\n",
    );
    const runArtifactRoot = path.join(tempDir, "run");
    fs.mkdirSync(runArtifactRoot, { recursive: true });

    // Mock runner: synthesise a diff hunk so the test does not depend on the
    // host having git installed. Status=1 means "diff exists" per
    // git-diff-index semantics.
    const runner = vi.fn().mockReturnValue({
      status: 1,
      stdout: `--- a/${failingWork}/tailor.config.ts\n+++ b/${passingWork}/tailor.config.ts\n@@ -1 +1,2 @@\n // hook missing\n+export const onCreate = () => {};\n`,
      stderr: "",
    });

    const outcome = emitIterDiff({
      perIteration: [failing, passing],
      runArtifactRoot,
      runner,
    });

    expect(outcome.kind).toBe("written");
    if (outcome.kind !== "written") return;
    expect(fs.existsSync(outcome.diffPath)).toBe(true);
    const content = fs.readFileSync(outcome.diffPath, "utf-8");
    expect(content).toContain("export const onCreate = () => {};");
    expect(outcome.diffPath).toBe(
      path.join(runArtifactRoot, "iter-diff", "m05-db-type-hooks-create.diff"),
    );
    // The runner was called with the failing tree first, passing second so the
    // diff reads "what needed to change to start passing".
    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0]).toEqual([failingWork, passingWork]);
  });

  it("skips with kind=no-diff when git reports identical trees (exit 0)", () => {
    const { result: failing } = makeIteration("iter-0", false, "identical\n");
    const { result: passing } = makeIteration("iter-1", true, "identical\n");
    const runArtifactRoot = path.join(tempDir, "run");
    const runner = vi.fn().mockReturnValue({ status: 0, stdout: "", stderr: "" });

    const outcome = emitIterDiff({
      perIteration: [failing, passing],
      runArtifactRoot,
      runner,
    });

    expect(outcome.kind).toBe("no-diff");
    // Defensive: directory should not be created when there is nothing to write.
    expect(fs.existsSync(path.join(runArtifactRoot, "iter-diff"))).toBe(false);
  });

  it("skips when every iteration passes or every iteration fails", () => {
    const allPassing = [
      makeIteration("iter-0", true, "x\n").result,
      makeIteration("iter-1", true, "x\n").result,
    ];
    const allFailing = [
      makeIteration("iter-2", false, "x\n").result,
      makeIteration("iter-3", false, "x\n").result,
    ];
    const runner = vi.fn();

    const pass = emitIterDiff({
      perIteration: allPassing,
      runArtifactRoot: path.join(tempDir, "run-pass"),
      runner,
    });
    const fail = emitIterDiff({
      perIteration: allFailing,
      runArtifactRoot: path.join(tempDir, "run-fail"),
      runner,
    });

    expect(pass.kind).toBe("skipped");
    expect(fail.kind).toBe("skipped");
    // No git call attempted when there is nothing to compare.
    expect(runner).not.toHaveBeenCalled();
  });

  it("skips when an iteration's work snapshot does not exist on disk", () => {
    const { result: failing } = makeIteration("iter-0", false, "x\n");
    // Passing iteration with no work snapshot:
    const passingNoWork: ProblemResult = {
      problemId: "m05",
      problemName: "m05",
      difficulty: "easy",
      category: "micro",
      stages: [{ stage: "tests", passed: true, output: "ok" }],
      passed: true,
      artifacts: { directory: path.join(tempDir, "iter-nowork") },
    };
    const runner = vi.fn();

    const outcome = emitIterDiff({
      perIteration: [failing, passingNoWork],
      runArtifactRoot: path.join(tempDir, "run"),
      runner,
    });

    expect(outcome.kind).toBe("skipped");
    expect(runner).not.toHaveBeenCalled();
  });

  it("propagates a non-1 git exit status as kind=skipped", () => {
    const { result: failing } = makeIteration("iter-0", false, "a\n");
    const { result: passing } = makeIteration("iter-1", true, "b\n");
    const runner = vi.fn().mockReturnValue({ status: 128, stdout: "", stderr: "fatal: ..." });

    const outcome = emitIterDiff({
      perIteration: [failing, passing],
      runArtifactRoot: path.join(tempDir, "run"),
      runner,
    });

    expect(outcome.kind).toBe("skipped");
    if (outcome.kind === "skipped") {
      expect(outcome.reason).toContain("status 128");
    }
  });

  // T1 strict-trigger coverage: confirm that the three pass-rate regimes
  // (stable fail / flaky / stable pass) each take the expected emit path so
  // future refactors cannot silently broaden the trigger.
  it("triggers strictly inside the open interval passRate in (0, 1) — passRate=0 skips", () => {
    const allFailing = [
      makeIteration("iter-0", false, "a\n").result,
      makeIteration("iter-1", false, "b\n").result,
      makeIteration("iter-2", false, "c\n").result,
    ];
    const runner = vi.fn();
    const outcome = emitIterDiff({
      perIteration: allFailing,
      runArtifactRoot: path.join(tempDir, "run-zero"),
      runner,
    });
    expect(outcome.kind).toBe("skipped");
    expect(runner).not.toHaveBeenCalled();
  });

  it("triggers strictly inside the open interval passRate in (0, 1) — passRate=1/3 emits", () => {
    const iters = [
      makeIteration("iter-0", false, "fail\n").result,
      makeIteration("iter-1", true, "pass\n").result,
      makeIteration("iter-2", false, "fail2\n").result,
    ];
    const runArtifactRoot = path.join(tempDir, "run-onethird");
    fs.mkdirSync(runArtifactRoot, { recursive: true });
    const runner = vi.fn().mockReturnValue({ status: 1, stdout: "diff body\n", stderr: "" });

    const outcome = emitIterDiff({ perIteration: iters, runArtifactRoot, runner });

    expect(outcome.kind).toBe("written");
    expect(runner).toHaveBeenCalledOnce();
  });

  it("triggers strictly inside the open interval passRate in (0, 1) — passRate=1 skips", () => {
    const allPassing = [
      makeIteration("iter-0", true, "a\n").result,
      makeIteration("iter-1", true, "b\n").result,
      makeIteration("iter-2", true, "c\n").result,
    ];
    const runner = vi.fn();
    const outcome = emitIterDiff({
      perIteration: allPassing,
      runArtifactRoot: path.join(tempDir, "run-one"),
      runner,
    });
    expect(outcome.kind).toBe("skipped");
    expect(runner).not.toHaveBeenCalled();
  });
});

// T2: stable-fail iterations need a separate diff against the reference
// solution so an operator can read "what was the agent missing?" without
// invoking an LLM judge. The cases below cover the three pass-rate regimes
// plus the infra-failure escape hatch.
describe("emitFailVsSolutionDiff", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-failvsoln-test-"));
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function makeIteration(
    label: string,
    passed: boolean,
    workContent: string,
    overrides: Partial<ProblemResult> = {},
  ): ProblemResult {
    const artifactDir = path.join(tempDir, label);
    const workDir = path.join(artifactDir, "attempt-0", "work");
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, "tailor.config.ts"), workContent);
    return {
      problemId: "m24-cli-retry-loop-detection",
      problemName: "cli-retry-loop-detection",
      difficulty: "hard",
      category: "micro",
      stages: [{ stage: "tests", passed, output: passed ? "ok" : "fail" }],
      passed,
      artifacts: { directory: artifactDir },
      ...overrides,
    };
  }

  function makeProblemDir(): string {
    const problemDir = path.join(tempDir, "problem");
    const solutionDir = path.join(problemDir, "solution");
    fs.mkdirSync(solutionDir, { recursive: true });
    fs.writeFileSync(path.join(solutionDir, "tailor.config.ts"), "// reference solution\n");
    return problemDir;
  }

  it("emits a .fail-vs-solution.diff when every iteration fails but solver completed", () => {
    const problemDir = makeProblemDir();
    const iters = [
      makeIteration("iter-0", false, "// wrong attempt 1\n"),
      makeIteration("iter-1", false, "// wrong attempt 2\n"),
      makeIteration("iter-2", false, "// wrong attempt 3\n"),
    ];
    const runArtifactRoot = path.join(tempDir, "run");
    fs.mkdirSync(runArtifactRoot, { recursive: true });

    const failingWork = path.join(iters[0]!.artifacts!.directory, "attempt-0", "work");
    const runner = vi.fn().mockReturnValue({
      status: 1,
      stdout: `--- a/base/tailor.config.ts\n+++ b/${failingWork}/tailor.config.ts\n@@ -1 +1 @@\n-// reference solution\n+// wrong attempt 1\n`,
      stderr: "",
    });

    const outcome = emitFailVsSolutionDiff({
      perIteration: iters,
      problemDir,
      runArtifactRoot,
      // Empty layer list keeps the fixture isolated from the real
      // `<challengeRoot>/shared/scaffold` tree on disk; the solution layer is
      // still appended by emitFailVsSolutionDiff itself.
      scaffoldLayers: [],
      runner,
    });

    expect(outcome.kind).toBe("written");
    if (outcome.kind !== "written") return;
    expect(outcome.diffPath).toBe(
      path.join(runArtifactRoot, "iter-diff", "m24-cli-retry-loop-detection.fail-vs-solution.diff"),
    );
    expect(fs.existsSync(outcome.diffPath)).toBe(true);
    expect(fs.readFileSync(outcome.diffPath, "utf-8")).toContain("// reference solution");
    // Runner sees the scaffolded solution base first, then the failing work
    // tree. The base is an ephemeral tmpdir created by emitFailVsSolutionDiff;
    // assert the shape rather than the exact path.
    expect(runner).toHaveBeenCalledOnce();
    const [base, work] = runner.mock.calls[0]!;
    expect(work).toBe(failingWork);
    expect(typeof base).toBe("string");
    expect(base).not.toBe(failingWork);
  });

  it("skips when any iteration passed (flaky / stable-pass cases)", () => {
    const problemDir = makeProblemDir();
    const flaky = [
      makeIteration("iter-0", false, "x\n"),
      makeIteration("iter-1", true, "y\n"),
      makeIteration("iter-2", false, "z\n"),
    ];
    const stablePass = [makeIteration("iter-3", true, "a\n"), makeIteration("iter-4", true, "b\n")];
    const runner = vi.fn();

    const flakyOutcome = emitFailVsSolutionDiff({
      perIteration: flaky,
      problemDir,
      runArtifactRoot: path.join(tempDir, "run-flaky"),
      runner,
    });
    const stableOutcome = emitFailVsSolutionDiff({
      perIteration: stablePass,
      problemDir,
      runArtifactRoot: path.join(tempDir, "run-stable"),
      runner,
    });

    expect(flakyOutcome.kind).toBe("skipped");
    expect(stableOutcome.kind).toBe("skipped");
    expect(runner).not.toHaveBeenCalled();
  });

  it("skips when every iteration is an infrastructure failure", () => {
    const problemDir = makeProblemDir();
    const infraStages: StageResult[] = [
      { stage: "generate", passed: false, output: "Skipped (infrastructure failure)" },
      { stage: "typecheck", passed: false, output: "Skipped (infrastructure failure)" },
      { stage: "tests", passed: false, output: "Skipped (infrastructure failure)" },
    ];
    const infraIters: ProblemResult[] = [
      { ...makeIteration("iter-0", false, "x\n"), stages: infraStages, passed: false },
      { ...makeIteration("iter-1", false, "y\n"), stages: infraStages, passed: false },
    ];
    const runner = vi.fn();

    const outcome = emitFailVsSolutionDiff({
      perIteration: infraIters,
      problemDir,
      runArtifactRoot: path.join(tempDir, "run-infra"),
      runner,
    });

    expect(outcome.kind).toBe("skipped");
    if (outcome.kind === "skipped") {
      expect(outcome.reason).toContain("infra");
    }
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns kind=no-diff (no file written) when the reference solution matches the work tree", () => {
    const problemDir = makeProblemDir();
    const iters = [makeIteration("iter-0", false, "// matches solution\n")];
    const runArtifactRoot = path.join(tempDir, "run-nodiff");
    const runner = vi.fn().mockReturnValue({ status: 0, stdout: "", stderr: "" });

    const outcome = emitFailVsSolutionDiff({
      perIteration: iters,
      problemDir,
      runArtifactRoot,
      runner,
    });

    expect(outcome.kind).toBe("no-diff");
    expect(fs.existsSync(path.join(runArtifactRoot, "iter-diff"))).toBe(false);
  });

  it("skips when the reference solution directory is missing", () => {
    const problemDir = path.join(tempDir, "problem-no-solution");
    fs.mkdirSync(problemDir, { recursive: true });
    const iters = [makeIteration("iter-0", false, "x\n")];
    const runner = vi.fn();
    const outcome = emitFailVsSolutionDiff({
      perIteration: iters,
      problemDir,
      runArtifactRoot: path.join(tempDir, "run-missing"),
      runner,
    });
    expect(outcome.kind).toBe("skipped");
    if (outcome.kind === "skipped") {
      expect(outcome.reason).toContain("solution dir not found");
    }
    expect(runner).not.toHaveBeenCalled();
  });

  // Phase 5e T2: confirm the scaffold overlay actually strips scaffold noise.
  // Before Phase 5e the diff base was raw solution/ (impl-only) while work/
  // was scaffold + impl, so every scaffold file showed up as deleted in the
  // resulting diff. After Phase 5e the solution side is overlaid on the same
  // scaffold layers the solver saw, leaving only the AI's deviation from
  // reference in the diff body. This test uses the real git runner (no mock)
  // so the assertion exercises the genuine `git diff --no-index` semantics.
  it("emits a diff containing only the AI deviation, not scaffold noise", () => {
    const fakeChallengeRoot = path.join(tempDir, "challenge");
    const sharedScaffold = path.join(fakeChallengeRoot, "shared", "scaffold");
    const problemDir = path.join(fakeChallengeRoot, "problems", "m05");
    const perProblemScaffold = path.join(problemDir, "scaffold");
    const solutionDir = path.join(problemDir, "solution", "tailordb");
    fs.mkdirSync(sharedScaffold, { recursive: true });
    fs.mkdirSync(perProblemScaffold, { recursive: true });
    fs.mkdirSync(solutionDir, { recursive: true });

    // Scaffold layer: package.json (same content in both work/ and base/).
    const packageJson = JSON.stringify({ name: "scaffold", private: true }, null, 2) + "\n";
    fs.writeFileSync(path.join(sharedScaffold, "package.json"), packageJson);

    // Reference solution: tailordb/x.ts with the correct hook implementation.
    fs.writeFileSync(
      path.join(solutionDir, "x.ts"),
      "export const x = { onCreate: () => 'reference' };\n",
    );

    // Failing work tree: same scaffold (so a naïve diff would call it "noise")
    // PLUS a different tailordb/x.ts (the actual AI deviation we want to see).
    const iterDir = path.join(tempDir, "iter-0");
    const workDir = path.join(iterDir, "attempt-0", "work");
    const workTailordb = path.join(workDir, "tailordb");
    fs.mkdirSync(workTailordb, { recursive: true });
    fs.writeFileSync(path.join(workDir, "package.json"), packageJson);
    fs.writeFileSync(
      path.join(workTailordb, "x.ts"),
      "export const x = { onCreate: () => 'AI got it wrong' };\n",
    );

    const iter: ProblemResult = {
      problemId: "m05-db-type-hooks-create",
      problemName: "db-type-hooks-create",
      difficulty: "easy",
      category: "micro",
      stages: [{ stage: "tests", passed: false, output: "fail" }],
      passed: false,
      artifacts: { directory: iterDir },
    };

    const runArtifactRoot = path.join(tempDir, "run");
    fs.mkdirSync(runArtifactRoot, { recursive: true });

    // Real git runner — no mock. The whole point is to verify the genuine
    // diff output, not just the runner-arg shape.
    const outcome = emitFailVsSolutionDiff({
      perIteration: [iter],
      problemDir,
      runArtifactRoot,
      // Inject the fake scaffold layers so the test is fully self-contained
      // and does not depend on the real `<challengeRoot>/shared/scaffold/`.
      scaffoldLayers: [sharedScaffold, perProblemScaffold],
    });

    expect(outcome.kind).toBe("written");
    if (outcome.kind !== "written") return;
    const content = fs.readFileSync(outcome.diffPath, "utf-8");

    // Real signal: the tailordb/x.ts deviation must be in the diff body.
    expect(content).toContain("tailordb/x.ts");
    expect(content).toContain("AI got it wrong");
    expect(content).toContain("reference");

    // Scaffold noise: package.json is the same on both sides, so it must NOT
    // appear in the diff. (Pre-Phase-5e this line would have appeared as
    // "deleted file mode" because solution side lacked the scaffold layer.)
    expect(content).not.toContain("package.json");
  });

  // Phase 5e T2 cleanup contract: the function creates a tmp scaffold-overlay
  // dir under os.tmpdir() and must remove it in a finally block so failed
  // runs do not leak. Snapshot the tmpdir entries before/after and assert no
  // new fail-vs-solution-* directory remains.
  it("removes the ephemeral scaffold-overlay tmpdir after emit", () => {
    const problemDir = makeProblemDir();
    const iters = [
      makeIteration("iter-0", false, "// wrong attempt\n"),
      makeIteration("iter-1", false, "// wrong attempt\n"),
    ];
    const runArtifactRoot = path.join(tempDir, "run-cleanup");
    fs.mkdirSync(runArtifactRoot, { recursive: true });
    const runner = vi.fn().mockReturnValue({
      status: 1,
      stdout: "diff body\n",
      stderr: "",
    });

    const before = new Set(
      fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("fail-vs-solution-")),
    );

    emitFailVsSolutionDiff({
      perIteration: iters,
      problemDir,
      runArtifactRoot,
      scaffoldLayers: [],
      runner,
    });

    const after = new Set(
      fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("fail-vs-solution-")),
    );
    // No new tmpdir should be left behind. (A concurrent test could create
    // its own — only assert that nothing leaked from THIS call.)
    for (const name of after) {
      expect(before.has(name)).toBe(true);
    }
  });
});

// T4: auto-extend only fires under the default 3-iteration cadence for the
// flaky middle band, and only when the user did not pin --iterations or pass
// --no-auto-extend. The matrix below covers every passedByIteration shape and
// every flag combination so future regressions are caught at the trigger level.
describe("shouldAutoExtend", () => {
  function fakeIter(passed: boolean): ProblemResult {
    return {
      problemId: "m05",
      problemName: "fixture",
      difficulty: "easy",
      category: "micro",
      stages: [{ stage: "tests", passed, output: passed ? "ok" : "fail" }],
      passed,
    };
  }
  const make = (passedFlags: boolean[]): ProblemResult[] => passedFlags.map(fakeIter);

  it("returns false for the zero-variance cases 0/3 and 3/3", () => {
    expect(
      shouldAutoExtend({
        perIteration: make([false, false, false]),
        iterations: 3,
        iterationsExplicit: false,
        noAutoExtend: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoExtend({
        perIteration: make([true, true, true]),
        iterations: 3,
        iterationsExplicit: false,
        noAutoExtend: false,
      }),
    ).toBe(false);
  });

  it("returns true for the flaky middle band 1/3 and 2/3", () => {
    expect(
      shouldAutoExtend({
        perIteration: make([true, false, false]),
        iterations: 3,
        iterationsExplicit: false,
        noAutoExtend: false,
      }),
    ).toBe(true);
    expect(
      shouldAutoExtend({
        perIteration: make([true, true, false]),
        iterations: 3,
        iterationsExplicit: false,
        noAutoExtend: false,
      }),
    ).toBe(true);
  });

  it("returns false when --iterations was set explicitly even for a flaky outcome", () => {
    expect(
      shouldAutoExtend({
        perIteration: make([true, false, false]),
        iterations: 3,
        iterationsExplicit: true,
        noAutoExtend: false,
      }),
    ).toBe(false);
  });

  it("returns false when --no-auto-extend is set even for a flaky outcome", () => {
    expect(
      shouldAutoExtend({
        perIteration: make([true, true, false]),
        iterations: 3,
        iterationsExplicit: false,
        noAutoExtend: true,
      }),
    ).toBe(false);
  });

  it("returns false when iterations is not the default 3 (e.g. 5)", () => {
    // Even though 2/5 is technically a middle-band ratio, auto-extend is
    // scoped to the default 3 to avoid surprise N=7 runs.
    expect(
      shouldAutoExtend({
        perIteration: make([true, true, false, false, false]),
        iterations: 5,
        iterationsExplicit: false,
        noAutoExtend: false,
      }),
    ).toBe(false);
  });
});

// Symmetric counterpart to shouldAutoExtend. Two phases:
//  - main: stop at n=2 when both iterations agree (the 3rd would be redundant)
//  - auto-extend: stop at n=4 when the 4th confirms majority (3/4 or 1/4);
//    a 2/4 split keeps the 5th iteration to break the tie.
describe("shouldEarlyStop", () => {
  function fakeIter(passed: boolean): ProblemResult {
    return {
      problemId: "m05",
      problemName: "fixture",
      difficulty: "easy",
      category: "micro",
      stages: [{ stage: "tests", passed, output: passed ? "ok" : "fail" }],
      passed,
    };
  }
  const make = (passedFlags: boolean[]): ProblemResult[] => passedFlags.map(fakeIter);

  describe("main phase", () => {
    it("returns true when the first two iterations both pass", () => {
      expect(
        shouldEarlyStop({
          perIteration: make([true, true]),
          iterations: 3,
          iterationsExplicit: false,
          noEarlyStop: false,
          phase: "main",
        }),
      ).toBe(true);
    });

    it("returns true when the first two iterations both fail", () => {
      expect(
        shouldEarlyStop({
          perIteration: make([false, false]),
          iterations: 3,
          iterationsExplicit: false,
          noEarlyStop: false,
          phase: "main",
        }),
      ).toBe(true);
    });

    it("returns false when the first two iterations disagree", () => {
      expect(
        shouldEarlyStop({
          perIteration: make([true, false]),
          iterations: 3,
          iterationsExplicit: false,
          noEarlyStop: false,
          phase: "main",
        }),
      ).toBe(false);
    });

    it("returns false at n=1 (sample too thin to short-circuit)", () => {
      expect(
        shouldEarlyStop({
          perIteration: make([true]),
          iterations: 3,
          iterationsExplicit: false,
          noEarlyStop: false,
          phase: "main",
        }),
      ).toBe(false);
    });

    it("returns false at n=3 (main loop already exhausted)", () => {
      expect(
        shouldEarlyStop({
          perIteration: make([true, true, true]),
          iterations: 3,
          iterationsExplicit: false,
          noEarlyStop: false,
          phase: "main",
        }),
      ).toBe(false);
    });
  });

  describe("auto-extend phase", () => {
    it("returns true at n=4 with cumulative 3/4 (original 2/3 confirmed by pass)", () => {
      expect(
        shouldEarlyStop({
          perIteration: make([true, true, false, true]),
          iterations: 3,
          iterationsExplicit: false,
          noEarlyStop: false,
          phase: "auto-extend",
        }),
      ).toBe(true);
    });

    it("returns true at n=4 with cumulative 1/4 (original 1/3 confirmed by fail)", () => {
      expect(
        shouldEarlyStop({
          perIteration: make([true, false, false, false]),
          iterations: 3,
          iterationsExplicit: false,
          noEarlyStop: false,
          phase: "auto-extend",
        }),
      ).toBe(true);
    });

    it("returns false at n=4 with cumulative 2/4 (split — keep iteration 5)", () => {
      expect(
        shouldEarlyStop({
          perIteration: make([true, true, false, false]),
          iterations: 3,
          iterationsExplicit: false,
          noEarlyStop: false,
          phase: "auto-extend",
        }),
      ).toBe(false);
    });

    it("returns false at n=3 (extension hasn't produced a sample yet)", () => {
      expect(
        shouldEarlyStop({
          perIteration: make([true, true, false]),
          iterations: 3,
          iterationsExplicit: false,
          noEarlyStop: false,
          phase: "auto-extend",
        }),
      ).toBe(false);
    });
  });

  describe("flag guards", () => {
    it("returns false when --iterations was set explicitly", () => {
      expect(
        shouldEarlyStop({
          perIteration: make([true, true]),
          iterations: 3,
          iterationsExplicit: true,
          noEarlyStop: false,
          phase: "main",
        }),
      ).toBe(false);
    });

    it("returns false when --no-early-stop is set", () => {
      expect(
        shouldEarlyStop({
          perIteration: make([true, true]),
          iterations: 3,
          iterationsExplicit: false,
          noEarlyStop: true,
          phase: "main",
        }),
      ).toBe(false);
    });

    it("returns false when iterations is not the default 3 (e.g. 5)", () => {
      expect(
        shouldEarlyStop({
          perIteration: make([true, true]),
          iterations: 5,
          iterationsExplicit: false,
          noEarlyStop: false,
          phase: "main",
        }),
      ).toBe(false);
    });
  });
});
