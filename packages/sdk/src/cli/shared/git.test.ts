import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  currentBranch,
  detectBaseRef,
  gitTopLevel,
  prepareMergeWorktree,
  revParse,
  runGit,
} from "./git";

async function initTestRepo(dir: string) {
  await runGit(["init", "--initial-branch=main", dir]);
  const cfg = { cwd: dir };
  await runGit(["config", "user.email", "test@example.com"], cfg);
  await runGit(["config", "user.name", "Test"], cfg);
  await runGit(["config", "commit.gpgsign", "false"], cfg);
  await runGit(["config", "tag.gpgsign", "false"], cfg);
}

async function commitFile(dir: string, file: string, content: string, message: string) {
  fs.writeFileSync(path.join(dir, file), content);
  await runGit(["add", file], { cwd: dir });
  await runGit(["commit", "-m", message], { cwd: dir });
}

describe("git", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("runGit", () => {
    it("returns stdout for a successful command", async () => {
      await initTestRepo(tmpDir);
      const result = await runGit(["rev-parse", "--is-inside-work-tree"], { cwd: tmpDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("true");
    });

    it("throws when the command fails by default", async () => {
      await expect(runGit(["rev-parse", "HEAD"], { cwd: tmpDir })).rejects.toThrow();
    });

    it("does not throw when allowFail is true", async () => {
      const result = await runGit(["rev-parse", "HEAD"], { cwd: tmpDir, allowFail: true });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.length).toBeGreaterThan(0);
    });

    it("resolves with exit code 127 when the binary is not found and allowFail is true", async () => {
      const result = await runGit(["--version"], {
        allowFail: true,
        env: { PATH: "/nonexistent" },
      });
      expect(result.exitCode).toBe(127);
      expect(result.stderr.length).toBeGreaterThan(0);
    });

    it("rejects when the binary is not found and allowFail is not set", async () => {
      await expect(runGit(["--version"], { env: { PATH: "/nonexistent" } })).rejects.toThrow();
    });
  });

  describe("gitTopLevel", () => {
    it("returns the repository root", async () => {
      await initTestRepo(tmpDir);
      const root = await gitTopLevel(tmpDir);
      expect(fs.realpathSync(root)).toBe(fs.realpathSync(tmpDir));
    });

    it("throws outside a repository", async () => {
      await expect(gitTopLevel(tmpDir)).rejects.toThrow();
    });
  });

  describe("currentBranch", () => {
    it("returns the branch name on a named branch", async () => {
      await initTestRepo(tmpDir);
      await commitFile(tmpDir, "a.txt", "a", "first");
      expect(await currentBranch(tmpDir)).toBe("main");
    });

    it("returns null when HEAD is detached", async () => {
      await initTestRepo(tmpDir);
      await commitFile(tmpDir, "a.txt", "a", "first");
      const sha = (await revParse("HEAD", tmpDir)).slice(0, 40);
      await runGit(["checkout", "--detach", sha], { cwd: tmpDir });
      expect(await currentBranch(tmpDir)).toBeNull();
    });
  });

  describe("revParse", () => {
    it("resolves HEAD to a 40-char SHA", async () => {
      await initTestRepo(tmpDir);
      await commitFile(tmpDir, "a.txt", "a", "first");
      const sha = await revParse("HEAD", tmpDir);
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe("detectBaseRef", () => {
    it("prefers GITHUB_BASE_REF when set by CI and the ref is fetched", async () => {
      const result = await detectBaseRef({
        cwd: tmpDir,
        env: { GITHUB_BASE_REF: "main", GITHUB_REPOSITORY: "acme/repo" },
        runGh: async () => {
          throw new Error("gh should not be called when GITHUB_BASE_REF is set and verified");
        },
        runGitCmd: async (args) => {
          if (args[0] === "remote" && args[1] === "-v") {
            return {
              stdout: "origin\thttps://github.com/acme/repo.git (fetch)",
              stderr: "",
              exitCode: 0,
            };
          }
          if (args[0] === "rev-parse" && args.includes("origin/main")) {
            return { stdout: "deadbeef\n", stderr: "", exitCode: 0 };
          }
          throw new Error(`unexpected git call: ${args.join(" ")}`);
        },
      });
      expect(result).toBe("origin/main");
    });

    it("maps GITHUB_BASE_REF to the base-repo remote in fork-style CI checkouts", async () => {
      const result = await detectBaseRef({
        cwd: tmpDir,
        env: {
          GITHUB_BASE_REF: "main",
          GITHUB_REPOSITORY: "upstream/repo",
          GITHUB_SERVER_URL: "https://github.com",
        },
        runGh: async () => {
          throw new Error("gh should not be called when GITHUB_BASE_REF is set and verified");
        },
        runGitCmd: async (args) => {
          if (args[0] === "remote" && args[1] === "-v") {
            return {
              stdout: [
                "origin\thttps://github.com/contributor/repo.git (fetch)",
                "origin\thttps://github.com/contributor/repo.git (push)",
                "upstream\thttps://github.com/upstream/repo.git (fetch)",
                "upstream\thttps://github.com/upstream/repo.git (push)",
              ].join("\n"),
              stderr: "",
              exitCode: 0,
            };
          }
          if (args[0] === "rev-parse" && args.includes("upstream/main")) {
            return { stdout: "deadbeef\n", stderr: "", exitCode: 0 };
          }
          return { stdout: "", stderr: "", exitCode: 1 };
        },
      });
      expect(result).toBe("upstream/main");
    });

    it("throws when GITHUB_BASE_REF names an un-fetched ref instead of falling back", async () => {
      await expect(
        detectBaseRef({
          cwd: tmpDir,
          env: { GITHUB_BASE_REF: "main" },
          runGh: async () => {
            throw new Error("gh must not be consulted when GITHUB_BASE_REF is authoritative");
          },
          runGitCmd: async () => ({ stdout: "", stderr: "", exitCode: 1 }),
        }),
      ).rejects.toThrow(/GITHUB_BASE_REF is "main".*not available/);
    });

    it("prefers the gh PR base ref when GITHUB_BASE_REF is absent", async () => {
      const result = await detectBaseRef({
        cwd: tmpDir,
        env: {},
        runGh: async () => ({
          stdout: JSON.stringify({
            baseRefName: "main",
            url: "https://github.com/acme/repo/pull/42",
          }),
          stderr: "",
          exitCode: 0,
        }),
        runGitCmd: async (args) => {
          if (args[0] === "remote" && args[1] === "-v") {
            return {
              stdout: [
                "origin\thttps://github.com/acme/repo.git (fetch)",
                "origin\thttps://github.com/acme/repo.git (push)",
              ].join("\n"),
              stderr: "",
              exitCode: 0,
            };
          }
          if (args[0] === "rev-parse" && args.includes("origin/main")) {
            return { stdout: "deadbeef\n", stderr: "", exitCode: 0 };
          }
          return { stdout: "", stderr: "", exitCode: 1 };
        },
      });
      expect(result).toBe("origin/main");
    });

    it("maps the gh PR base to the upstream remote in a fork-style checkout", async () => {
      const result = await detectBaseRef({
        cwd: tmpDir,
        env: {},
        runGh: async () => ({
          stdout: JSON.stringify({
            baseRefName: "main",
            url: "https://github.com/upstream/repo/pull/7",
          }),
          stderr: "",
          exitCode: 0,
        }),
        runGitCmd: async (args) => {
          if (args[0] === "remote" && args[1] === "-v") {
            return {
              stdout: [
                "origin\tgit@github.com:contributor/repo.git (fetch)",
                "origin\tgit@github.com:contributor/repo.git (push)",
                "upstream\thttps://github.com/upstream/repo.git (fetch)",
                "upstream\thttps://github.com/upstream/repo.git (push)",
              ].join("\n"),
              stderr: "",
              exitCode: 0,
            };
          }
          if (args[0] === "rev-parse" && args.includes("upstream/main")) {
            return { stdout: "deadbeef\n", stderr: "", exitCode: 0 };
          }
          return { stdout: "", stderr: "", exitCode: 1 };
        },
      });
      expect(result).toBe("upstream/main");
    });

    it("throws when the gh-reported PR base ref is not fetched locally instead of falling back", async () => {
      await expect(
        detectBaseRef({
          cwd: tmpDir,
          env: {},
          runGh: async () => ({
            stdout: JSON.stringify({
              baseRefName: "release",
              url: "https://github.com/acme/repo/pull/1",
            }),
            stderr: "",
            exitCode: 0,
          }),
          runGitCmd: async (args) => {
            if (args[0] === "remote" && args[1] === "-v") {
              return {
                stdout: "origin\thttps://github.com/acme/repo.git (fetch)",
                stderr: "",
                exitCode: 0,
              };
            }
            return { stdout: "", stderr: "fatal", exitCode: 1 };
          },
        }),
      ).rejects.toThrow(/gh reported PR base "release".*not available/);
    });

    it("falls back to origin/HEAD symbolic ref when gh is unavailable", async () => {
      const result = await detectBaseRef({
        cwd: tmpDir,
        env: {},
        runGh: async () => ({ stdout: "", stderr: "gh: not found", exitCode: 127 }),
        runGitCmd: async () => ({ stdout: "origin/main\n", stderr: "", exitCode: 0 }),
      });
      expect(result).toBe("origin/main");
    });

    it("returns null when neither gh nor origin/HEAD work", async () => {
      const result = await detectBaseRef({
        cwd: tmpDir,
        env: {},
        runGh: async () => ({ stdout: "", stderr: "err", exitCode: 1 }),
        runGitCmd: async () => ({ stdout: "", stderr: "err", exitCode: 1 }),
      });
      expect(result).toBeNull();
    });

    it("ignores empty stdout from gh", async () => {
      const result = await detectBaseRef({
        cwd: tmpDir,
        env: {},
        runGh: async () => ({ stdout: "\n", stderr: "", exitCode: 0 }),
        runGitCmd: async () => ({ stdout: "origin/main\n", stderr: "", exitCode: 0 }),
      });
      expect(result).toBe("origin/main");
    });

    it("ignores empty GITHUB_BASE_REF and falls through to gh", async () => {
      const result = await detectBaseRef({
        cwd: tmpDir,
        env: { GITHUB_BASE_REF: "" },
        runGh: async () => ({
          stdout: JSON.stringify({
            baseRefName: "release",
            url: "https://github.com/acme/repo/pull/3",
          }),
          stderr: "",
          exitCode: 0,
        }),
        runGitCmd: async (args) => {
          if (args[0] === "remote" && args[1] === "-v") {
            return {
              stdout: "origin\thttps://github.com/acme/repo.git (fetch)",
              stderr: "",
              exitCode: 0,
            };
          }
          if (args[0] === "rev-parse" && args.includes("origin/release")) {
            return { stdout: "deadbeef\n", stderr: "", exitCode: 0 };
          }
          return { stdout: "", stderr: "", exitCode: 1 };
        },
      });
      expect(result).toBe("origin/release");
    });
  });

  describe("prepareMergeWorktree", () => {
    it("creates a worktree containing the merged content", async () => {
      await initTestRepo(tmpDir);
      await commitFile(tmpDir, "base.txt", "base\n", "base");
      await runGit(["checkout", "-b", "feature"], { cwd: tmpDir });
      await commitFile(tmpDir, "feature.txt", "feat\n", "feat");

      const prepared = await prepareMergeWorktree({
        repoRoot: tmpDir,
        baseRef: "main",
        headRef: "feature",
      });
      try {
        expect(fs.existsSync(path.join(prepared.path, "base.txt"))).toBe(true);
        expect(fs.existsSync(path.join(prepared.path, "feature.txt"))).toBe(true);
        expect(prepared.baseRef).toMatch(/^[0-9a-f]{40}$/);
        expect(prepared.headRef).toMatch(/^[0-9a-f]{40}$/);
      } finally {
        await prepared.dispose();
      }
      expect(fs.existsSync(prepared.path)).toBe(false);
    });

    it("throws with a descriptive error when merge conflicts occur", async () => {
      await initTestRepo(tmpDir);
      await commitFile(tmpDir, "conflict.txt", "base\n", "base");
      await runGit(["checkout", "-b", "feature"], { cwd: tmpDir });
      await commitFile(tmpDir, "conflict.txt", "from-feature\n", "feat");
      await runGit(["checkout", "main"], { cwd: tmpDir });
      await commitFile(tmpDir, "conflict.txt", "from-main\n", "main change");

      await expect(
        prepareMergeWorktree({ repoRoot: tmpDir, baseRef: "main", headRef: "feature" }),
      ).rejects.toThrow(/conflict/i);
    });

    it("dispose is idempotent", async () => {
      await initTestRepo(tmpDir);
      await commitFile(tmpDir, "a.txt", "a", "first");

      const prepared = await prepareMergeWorktree({
        repoRoot: tmpDir,
        baseRef: "main",
        headRef: "HEAD",
      });
      await prepared.dispose();
      await expect(prepared.dispose()).resolves.toBeUndefined();
    });

    it("ignores a repo-local post-checkout hook that would otherwise fail", async () => {
      await initTestRepo(tmpDir);
      await commitFile(tmpDir, "base.txt", "b", "base");
      await runGit(["checkout", "-b", "feature"], { cwd: tmpDir });
      await commitFile(tmpDir, "feat.txt", "f", "feat");
      await runGit(["checkout", "main"], { cwd: tmpDir });

      // A failing post-checkout hook must not leak stale .git/worktrees metadata.
      const hooksDir = path.join(tmpDir, ".git", "hooks");
      fs.mkdirSync(hooksDir, { recursive: true });
      fs.writeFileSync(path.join(hooksDir, "post-checkout"), "#!/bin/sh\nexit 1\n", {
        mode: 0o755,
      });

      const prepared = await prepareMergeWorktree({
        repoRoot: tmpDir,
        baseRef: "main",
        headRef: "feature",
      });
      try {
        expect(fs.existsSync(path.join(prepared.path, "feat.txt"))).toBe(true);
      } finally {
        await prepared.dispose();
      }
      const worktreesList = await runGit(["worktree", "list", "--porcelain"], { cwd: tmpDir });
      expect(worktreesList.stdout).not.toContain(prepared.path);
    });
  });
});
