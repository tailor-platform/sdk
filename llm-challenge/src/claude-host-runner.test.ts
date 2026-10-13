import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { aroundEach, describe, expect, test } from "vitest";
import {
  buildClaudeHostArgs,
  buildHostEnv,
  buildHostSettings,
  runClaudeOnHost,
} from "./claude-host-runner";

const tempDirs: string[] = [];

aroundEach(async (runTest) => {
  await runTest();
  const dirs = [...tempDirs];
  tempDirs.length = 0;
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "llm-challenge-host-")));
  tempDirs.push(dir);
  return dir;
}

describe("host environment", () => {
  test("passes only the allowlisted variables and the explicit extras", () => {
    const env = buildHostEnv(
      {
        PATH: "/usr/bin",
        HOME: "/home/me",
        LANG: "C",
        CLAUDECODE: "1",
        ANTHROPIC_API_KEY: "key",
        CLAUDE_CODE_OAUTH_TOKEN: "token",
        GITHUB_TOKEN: "gh",
      },
      { PNPM_CONFIG_STORE_DIR: "/store" },
    );

    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/me",
      LANG: "C",
      PNPM_CONFIG_STORE_DIR: "/store",
    });
  });
});

describe("host isolation settings", () => {
  const options = {
    repoRoot: "/repo",
    worktreePath: "/repo/llm-challenge/results/r1/sdk-api/p/run-0/work",
    sharedPnpmStorePath: "/repo/llm-challenge/.cache/pnpm-store/no-docs",
  };

  test("limits file tools to the worktree instead of bypassing permissions", () => {
    const { permissions } = buildHostSettings(options);

    expect(permissions.allow).toEqual([
      "Bash",
      "Glob",
      "Grep",
      "Read(//repo/llm-challenge/results/r1/sdk-api/p/run-0/work/**)",
      "Edit(//repo/llm-challenge/results/r1/sdk-api/p/run-0/work/**)",
    ]);
  });

  test("hides the repository and credentials from shell commands except the worktree and store", () => {
    const { sandbox } = buildHostSettings(options);

    expect(sandbox).toMatchObject({
      enabled: true,
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
    });
    expect(sandbox.filesystem.denyRead).toEqual(
      expect.arrayContaining(["/repo", "~/.ssh", "~/.claude.json", "~/.config"]),
    );
    expect(sandbox.filesystem.allowRead).toEqual([
      options.worktreePath,
      options.sharedPnpmStorePath,
    ]);
    expect(sandbox.filesystem.allowWrite).toEqual([options.sharedPnpmStorePath]);
  });

  test("allows only the package registry over the network", () => {
    expect(buildHostSettings(options).sandbox.network).toEqual({
      allowedDomains: ["registry.npmjs.org"],
      strictAllowlist: true,
    });
  });
});

describe("host claude command", () => {
  test("starts in safe mode with the isolation settings and without bypassing permissions", () => {
    const settings = buildHostSettings({ repoRoot: "/repo", worktreePath: "/repo/w" });
    const args = buildClaudeHostArgs({ model: "claude-opus-5-5", effort: "xhigh", settings });

    expect(args).toContain("--safe-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("default");
    expect(JSON.parse(args[args.indexOf("--settings") + 1])).toEqual(settings);
    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-5-5");
  });
});

describe("running claude on the host", () => {
  async function setUp(script: string) {
    const dir = await makeTempDir();
    const installCacheDir = path.join(dir, "cache");
    await fs.mkdir(path.join(installCacheDir, "bin"), { recursive: true });
    await fs.writeFile(path.join(installCacheDir, "bin", "claude"), `#!/bin/sh\n${script}\n`);
    await fs.chmod(path.join(installCacheDir, "bin", "claude"), 0o755);
    const worktreePath = path.join(dir, "work");
    await fs.mkdir(worktreePath);
    await fs.writeFile(path.join(dir, "prompt.md"), "task");
    return {
      dir,
      worktreePath,
      options: {
        repoRoot: dir,
        worktreePath,
        promptPath: path.join(dir, "prompt.md"),
        solverStdoutPath: path.join(dir, "stdout.log"),
        solverStderrPath: path.join(dir, "stderr.log"),
        tracePath: path.join(dir, "trace.jsonl"),
        model: "claude-opus-5-5",
        effort: "xhigh",
        maxSeconds: 5,
        runtime: {
          image: "",
          claudePackage: "@anthropic-ai/claude-code@2.1.285",
          tokenFile: "",
          installCacheDir,
        },
      },
    };
  }

  test("runs in the worktree with a filtered environment and records the stream", async () => {
    process.env.LLM_CHALLENGE_HOST_TEST_SECRET = "secret";
    const { dir, worktreePath, options } = await setUp(
      `pwd > "${"$"}0.cwd"; env > "${"$"}0.env"; cat > /dev/null; echo '{"type":"result"}'`,
    );

    const result = await runClaudeOnHost(options);
    delete process.env.LLM_CHALLENGE_HOST_TEST_SECRET;

    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    const binary = path.join(options.runtime.installCacheDir, "bin", "claude");
    expect((await fs.readFile(`${binary}.cwd`, "utf8")).trim()).toBe(worktreePath);
    const env = await fs.readFile(`${binary}.env`, "utf8");
    expect(env).not.toContain("LLM_CHALLENGE_HOST_TEST_SECRET");
    expect(env).toContain("PATH=");
    expect(await fs.readFile(path.join(dir, "trace.jsonl"), "utf8")).toBe('{"type":"result"}\n');
  });

  test("kills the whole process group on timeout so no child outlives the run", async () => {
    const { dir, options } = await setUp(`sleep 30 & echo $! > "${"$"}0.pid"; wait`);

    const result = await runClaudeOnHost({ ...options, maxSeconds: 1 });

    expect(result.timedOut).toBe(true);
    const pid = Number(
      (await fs.readFile(path.join(dir, "cache", "bin", "claude.pid"), "utf8")).trim(),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(() => process.kill(pid, 0)).toThrow("ESRCH");
  });
});
