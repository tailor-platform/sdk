import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { translatePath } from "./merge-plan-setup";

describe("translatePath", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mp-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns a worktree-relative path when the original is inside the repo", () => {
    const repoRoot = path.join(tmp, "repo");
    const worktree = path.join(tmp, "work");
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(worktree, { recursive: true });
    const original = path.join(repoRoot, "example/tailor.config.ts");
    expect(translatePath({ originalAbsPath: original, repoRoot, worktreeRoot: worktree })).toBe(
      path.join(worktree, "example/tailor.config.ts"),
    );
  });

  it("throws when the original path is outside the repository", () => {
    const repoRoot = path.join(tmp, "repo");
    const worktree = path.join(tmp, "work");
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(worktree, { recursive: true });
    const outside = path.join(tmp, "outside/tailor.config.ts");
    expect(() =>
      translatePath({ originalAbsPath: outside, repoRoot, worktreeRoot: worktree }),
    ).toThrow(/outside the repository/);
  });

  it("handles paths at the repo root", () => {
    const repoRoot = path.join(tmp, "repo");
    const worktree = path.join(tmp, "work");
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(worktree, { recursive: true });
    const original = path.join(repoRoot, "tailor.config.ts");
    expect(translatePath({ originalAbsPath: original, repoRoot, worktreeRoot: worktree })).toBe(
      path.join(worktree, "tailor.config.ts"),
    );
  });

  it("translates a monorepo subdirectory cwd into the matching worktree subdirectory", () => {
    const repoRoot = path.join(tmp, "repo");
    const worktree = path.join(tmp, "work");
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(worktree, { recursive: true });
    const originalCwd = path.join(repoRoot, "example");
    expect(translatePath({ originalAbsPath: originalCwd, repoRoot, worktreeRoot: worktree })).toBe(
      path.join(worktree, "example"),
    );
  });
});
