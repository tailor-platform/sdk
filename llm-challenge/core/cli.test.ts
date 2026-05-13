import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { problemKey } from "../shared/helpers";
import {
  applyScaffoldLayers,
  cleanupWorktree,
  deriveProblemName,
  emitIterDiff,
  packSdkFromRef,
} from "./cli";
import type { ProblemResult } from "./report";

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
});
