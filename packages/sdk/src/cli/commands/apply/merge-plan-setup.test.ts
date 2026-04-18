import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "@/cli/shared/git";
import { prepareBasePlan, translatePath } from "./merge-plan-setup";

async function initRepo(dir: string): Promise<void> {
  await runGit(["init", "--initial-branch=main", dir]);
  const cfg = { cwd: dir };
  await runGit(["config", "user.email", "test@example.com"], cfg);
  await runGit(["config", "user.name", "Test"], cfg);
  await runGit(["config", "commit.gpgsign", "false"], cfg);
  await runGit(["config", "tag.gpgsign", "false"], cfg);
}

async function commitFile(dir: string, file: string, content: string, message: string) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  await runGit(["add", file], { cwd: dir });
  await runGit(["commit", "-m", message], { cwd: dir });
}

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

describe("prepareBasePlan", () => {
  let tmp: string;
  let repoRoot: string;
  let originalCwd: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pbp-"));
    const rawRepo = path.join(tmp, "repo");
    fs.mkdirSync(rawRepo, { recursive: true });
    // macOS /tmp is a symlink to /private/tmp; git prints the resolved path,
    // so translatePath comparisons only line up after canonicalization.
    repoRoot = fs.realpathSync(rawRepo);
    await initRepo(repoRoot);
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns the worktree, translated config path, and base ref for a happy-path run", async () => {
    await commitFile(repoRoot, "pnpm-lock.yaml", "lock", "seed lock");
    await commitFile(repoRoot, "package.json", "{}", "seed root manifest");
    await commitFile(repoRoot, "tailor.config.ts", "export default {};\n", "seed config");
    await runGit(["branch", "base"], { cwd: repoRoot });
    await commitFile(repoRoot, "tailor.config.ts", "export default { v: 2 };\n", "feature change");

    process.chdir(repoRoot);
    const prepared = await prepareBasePlan({ baseRef: "base" });
    try {
      expect(prepared.baseRef).toBe("base");
      expect(prepared.cwd).toBe(prepared.worktree.path);
      expect(prepared.configPath).toBe(path.join(prepared.worktree.path, "tailor.config.ts"));
      expect(fs.existsSync(prepared.configPath)).toBe(true);
    } finally {
      await prepared.worktree.dispose();
    }
    expect(fs.existsSync(prepared.worktree.path)).toBe(false);
  });

  it("disposes the worktree when linkNodeModules aborts due to a lockfile mismatch", async () => {
    await commitFile(repoRoot, "pnpm-lock.yaml", "v1", "seed lock");
    await commitFile(repoRoot, "package.json", "{}", "seed root manifest");
    await commitFile(repoRoot, "tailor.config.ts", "export default {};\n", "seed config");
    await runGit(["branch", "base"], { cwd: repoRoot });
    // Advance HEAD on main without touching the lockfile, then bump the lock
    // on the base branch. Merging base into HEAD adopts base's lock, so the
    // merged worktree diverges from the source (still v1) and linkNodeModules
    // must abort.
    await commitFile(repoRoot, "other.txt", "main change", "unrelated main change");
    await runGit(["checkout", "base"], { cwd: repoRoot });
    await commitFile(repoRoot, "pnpm-lock.yaml", "v2", "bump lock on base");
    await runGit(["checkout", "main"], { cwd: repoRoot });

    process.chdir(repoRoot);
    await expect(prepareBasePlan({ baseRef: "base" })).rejects.toThrow(/pnpm-lock\.yaml/);

    // Worktree metadata must be cleaned up on abort so subsequent runs start
    // clean. `git worktree list --porcelain` omits pruned entries.
    const list = await runGit(["worktree", "list", "--porcelain"], { cwd: repoRoot });
    expect(list.stdout).not.toMatch(/tailor-merge-/);
  });

  it("throws a clear error when no base ref is passed and auto-detection fails", async () => {
    await commitFile(repoRoot, "tailor.config.ts", "export default {};\n", "seed config");

    process.chdir(repoRoot);
    await expect(
      prepareBasePlan({ baseRef: undefined }),
      // No origin/HEAD, no GITHUB_BASE_REF, no gh PR — detectBaseRef returns null.
    ).rejects.toThrow(/Could not detect base ref/);
  });

  it("throws when the config file cannot be found", async () => {
    await commitFile(repoRoot, "package.json", "{}", "seed root manifest");
    await runGit(["branch", "base"], { cwd: repoRoot });

    process.chdir(repoRoot);
    // No tailor.config.ts exists in source cwd; resolveOriginalConfigPath throws
    // before any worktree is created.
    await expect(prepareBasePlan({ baseRef: "base" })).rejects.toThrow(
      /tailor\.config\.ts not found/,
    );
  });
});
