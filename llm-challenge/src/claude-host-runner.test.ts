import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { aroundEach, describe, expect, test, vi } from "vitest";
import {
  buildClaudeHostArgs,
  buildHostEnv,
  buildHostSettings,
  assertHostRuntimeSupported,
  buildHostVerifierProfile,
  detectReadableToolchainPaths,
  installWorkspaceDepsOnHost,
  preflightClaudeOnHost,
  runClaudeOnHost,
  runJudgeOnHost,
} from "./claude-host-runner";

const tempDirs: string[] = [];

aroundEach(async (runTest) => {
  await runTest();
  vi.unstubAllEnvs();
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
      "Read(//repo/llm-challenge/results/r1/sdk-api/p/run-0/work/**)",
      "Edit(//repo/llm-challenge/results/r1/sdk-api/p/run-0/work/**)",
    ]);
  });

  test("does not allow Glob or Grep on their own, which would search outside the worktree", () => {
    expect(buildHostSettings(options).permissions.allow).not.toContain("Glob");
    expect(buildHostSettings(options).permissions.allow).not.toContain("Grep");
  });

  test("hides the repository and credentials from shell commands except the worktree and store", () => {
    const { sandbox } = buildHostSettings(options);

    expect(sandbox).toMatchObject({
      enabled: true,
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
    });
    expect(sandbox.filesystem.denyRead).toEqual(
      expect.arrayContaining([
        "/repo",
        "~/.ssh",
        "~/.claude.json",
        "~/.config",
        "~/.zsh_history",
        "~/.gitconfig",
      ]),
    );
    expect(sandbox.filesystem.allowRead).toEqual([
      options.worktreePath,
      options.sharedPnpmStorePath,
    ]);
    expect(
      buildHostSettings({ ...options, readableHomePaths: ["~/.config/mise"] }).sandbox.filesystem
        .allowRead,
    ).toEqual([options.worktreePath, options.sharedPnpmStorePath, "~/.config/mise"]);
    expect(sandbox.filesystem.allowWrite).toEqual([]);
  });

  test("blocks the network for shell commands, because any allowed host is a way to send data out", () => {
    expect(buildHostSettings(options).sandbox.network).toEqual({
      allowedDomains: [],
      strictAllowlist: true,
    });
  });
});

describe("toolchain read access", () => {
  test("opens the mise configuration only when mise shims are on PATH", () => {
    expect(
      detectReadableToolchainPaths({ PATH: "/home/me/.local/share/mise/shims:/usr/bin" }),
    ).toEqual(["~/.config/mise"]);
    expect(detectReadableToolchainPaths({ PATH: "/usr/local/bin:/usr/bin" })).toEqual([]);
  });
});

describe("host verifier profile", () => {
  const profile = buildHostVerifierProfile({
    homeDir: "/home/me",
    repoRoot: "/repo",
    worktreePath: "/repo/llm-challenge/results/r/work",
    typescriptPath: "/repo/node_modules/typescript",
  });

  test("forbids every file write except /dev/null", () => {
    expect(profile).toContain("(deny file-write*)");
    expect(profile).toContain('(allow file-write* (literal "/dev/null"))');
  });

  test("hides credentials and the repository from the compiler", () => {
    expect(profile).toContain('(deny file-read* (subpath "/home/me/.ssh"))');
    expect(profile).toContain('(deny file-read* (subpath "/repo"))');
  });

  test("re-allows the worktree and the trusted compiler after the repository is hidden", () => {
    const repoDeny = profile.indexOf('(deny file-read* (subpath "/repo"))');

    expect(
      profile.indexOf('(allow file-read* (subpath "/repo/llm-challenge/results/r/work"))'),
    ).toBeGreaterThan(repoDeny);
    expect(
      profile.indexOf('(allow file-read* (subpath "/repo/node_modules/typescript"))'),
    ).toBeGreaterThan(repoDeny);
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

  test("writes the permission rules with the real worktree path even when given a symlink", async () => {
    const { dir, worktreePath, options } = await setUp(
      `printf '%s\\n' "$@" > "${"$"}0.args"; cat > /dev/null`,
    );
    const link = path.join(dir, "link-to-work");
    await fs.symlink(worktreePath, link);

    await runClaudeOnHost({ ...options, worktreePath: link });

    const args = await fs.readFile(path.join(dir, "cache", "bin", "claude.args"), "utf8");
    const settings = JSON.parse(args.split("\n")[args.split("\n").indexOf("--settings") + 1]);
    expect(settings.permissions.allow).toContain(`Read(/${worktreePath}/**)`);
  });

  test("kills the whole process group on timeout so no child outlives the run", async () => {
    const { dir, options } = await setUp(`sleep 30 & echo $! > "${"$"}0.pid"; wait`);

    const result = await runClaudeOnHost({ ...options, maxSeconds: 2 });

    expect(result.timedOut).toBe(true);
    const pid = Number(
      (await fs.readFile(path.join(dir, "cache", "bin", "claude.pid"), "utf8")).trim(),
    );
    const isAlive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let attempt = 0; attempt < 30 && isAlive(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(isAlive()).toBe(false);
  });
});

describe("host preflight", () => {
  const probeScript = `if [ "$1" = "--version" ]; then echo "2.1.285 (Claude Code)"; exit 0; fi
cat > /dev/null
echo '{"type":"assistant","parent_tool_use_id":null,"message":{"model":"claude-opus-5-5","content":[]}}'
echo '{"type":"result","subtype":"success","is_error":false}'`;

  async function setUp(claudePackage: string) {
    const dir = await makeTempDir();
    const installCacheDir = path.join(dir, "cache");
    await fs.mkdir(path.join(installCacheDir, "bin"), { recursive: true });
    await fs.writeFile(path.join(installCacheDir, "bin", "claude"), `#!/bin/sh\n${probeScript}\n`);
    await fs.chmod(path.join(installCacheDir, "bin", "claude"), 0o755);
    return { image: "", claudePackage, tokenFile: "", installCacheDir };
  }

  test("passes when the pinned version answers the model probe with the requested model", async () => {
    const runtime = await setUp("@anthropic-ai/claude-code@2.1.285");

    const result = await preflightClaudeOnHost({ runtime, model: "claude-opus-5-5" });

    expect(result).toMatchObject({ exitCode: 0, claudeVersion: "2.1.285" });
  });

  test("fails when the installed version differs from the pin", async () => {
    const runtime = await setUp("@anthropic-ai/claude-code@2.1.300");

    const result = await preflightClaudeOnHost({ runtime, model: "claude-opus-5-5" });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("expected Claude Code 2.1.300, got 2.1.285");
  });
});

describe("host runtime support", () => {
  test("needs macOS because the type check is confined with sandbox-exec", () => {
    expect(() => assertHostRuntimeSupported("darwin")).not.toThrow();
    expect(() => assertHostRuntimeSupported("linux")).toThrow("macOS");
  });
});

describe("running the judge on the host", () => {
  test("reads the workspace as its working directory and the evidence as an added directory", async () => {
    const dir = await makeTempDir();
    const installCacheDir = path.join(dir, "cache");
    await fs.mkdir(path.join(installCacheDir, "bin"), { recursive: true });
    const binary = path.join(installCacheDir, "bin", "claude");
    await fs.writeFile(
      binary,
      `#!/bin/sh\npwd > "$0.cwd"; printf '%s\\n' "$@" > "$0.args"; env > "$0.env"; cat > /dev/null\n`,
    );
    await fs.chmod(binary, 0o755);
    const workspaceDir = path.join(dir, "workspace");
    const evidenceDir = path.join(dir, "evidence");
    await fs.mkdir(workspaceDir);
    await fs.mkdir(evidenceDir);
    process.env.LLM_CHALLENGE_HOST_TEST_SECRET = "secret";

    const result = await runJudgeOnHost({
      workspaceDir,
      evidenceDir,
      prompt: "grade",
      model: "claude-opus-5-5",
      effort: "high",
      schema: { type: "object" },
      runtime: {
        image: "",
        claudePackage: "@anthropic-ai/claude-code@2.1.285",
        tokenFile: "",
        installCacheDir,
      },
      stdoutPath: path.join(dir, "stdout.log"),
      stderrPath: path.join(dir, "stderr.log"),
      tracePath: path.join(dir, "trace.jsonl"),
      maxSeconds: 5,
    });
    delete process.env.LLM_CHALLENGE_HOST_TEST_SECRET;

    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect((await fs.readFile(`${binary}.cwd`, "utf8")).trim()).toBe(workspaceDir);
    const args = (await fs.readFile(`${binary}.args`, "utf8")).split("\n");
    expect(args[args.indexOf("--add-dir") + 1]).toBe(evidenceDir);
    expect(args).toContain("--safe-mode");
    expect(await fs.readFile(`${binary}.env`, "utf8")).not.toContain(
      "LLM_CHALLENGE_HOST_TEST_SECRET",
    );
  });
});

describe("installing workspace dependencies on the host", () => {
  async function setUp(script: string) {
    const dir = await makeTempDir();
    const bin = path.join(dir, "bin");
    await fs.mkdir(bin);
    await fs.writeFile(path.join(bin, "pnpm"), `#!/bin/sh\n${script}\n`);
    await fs.chmod(path.join(bin, "pnpm"), 0o755);
    vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH ?? ""}`);
    const worktreePath = path.join(dir, "work");
    await fs.mkdir(worktreePath);
    return { dir, worktreePath };
  }

  test("installs without lifecycle scripts, in the worktree, with the shared store", async () => {
    const { dir, worktreePath } = await setUp(
      `pwd > "${"$"}0.cwd"; echo "$@" > "${"$"}0.args"; echo "$PNPM_CONFIG_STORE_DIR" > "${"$"}0.store"; echo "$PNPM_CONFIG_PACKAGE_IMPORT_METHOD" > "${"$"}0.method"`,
    );

    await installWorkspaceDepsOnHost({ worktreePath, sharedPnpmStorePath: "/the/store" });

    const read = (name: string) => fs.readFile(path.join(dir, "bin", `pnpm.${name}`), "utf8");
    expect((await read("cwd")).trim()).toBe(await fs.realpath(worktreePath));
    expect((await read("args")).trim()).toBe("install --ignore-scripts");
    expect((await read("store")).trim()).toBe("/the/store");
    expect((await read("method")).trim()).toBe("copy");
  });

  test("fails with the package manager's output when the install fails", async () => {
    const { worktreePath } = await setUp('echo "registry unreachable" >&2; exit 1');

    await expect(
      installWorkspaceDepsOnHost({ worktreePath, sharedPnpmStorePath: "/the/store" }),
    ).rejects.toThrow("registry unreachable");
  });
});
