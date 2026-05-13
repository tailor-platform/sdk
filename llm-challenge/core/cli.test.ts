import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { problemKey } from "../shared/helpers";
import { applyScaffoldLayers, cleanupWorktree, deriveProblemName, packSdkFromRef } from "./cli";

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
