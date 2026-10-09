import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { aroundEach, describe, expect, test, vi } from "vitest";
import {
  CLAUDE_OAUTH_TOKEN_ENV,
  DEFAULT_CLAUDE_CODE_PACKAGE,
  getClaudeRuntimeConfig,
  buildClaudeBootstrapScript,
  buildClaudePreflightScript,
  buildClaudeSolverArgs,
  claudeInstallCacheDir,
  parsePinnedVersion,
  redactSecretInFiles,
  redactSecretInWorkspace,
  resolveClaudeOAuthToken,
  runClaudeInPodman,
} from "./claude-runner";
import { runJudgeInPodman } from "./judge";
import { buildAgentContainerArgs, runAgentContainer } from "./runner";

const tempDirs: string[] = [];

aroundEach(async (runTest) => {
  await runTest();
  vi.unstubAllEnvs();
  const dirs = [...tempDirs];
  tempDirs.length = 0;
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llm-challenge-claude-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("claude solver command", () => {
  test("runs a headless stream-json session without web tools", () => {
    const args = buildClaudeSolverArgs({ model: "claude-opus-5-5", effort: "xhigh" });

    expect(args.slice(0, 1)).toEqual(["-p"]);
    expect(args).toEqual(
      expect.arrayContaining([
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        "--strict-mcp-config",
      ]),
    );
    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-5-5");
    expect(args[args.indexOf("--effort") + 1]).toBe("xhigh");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    expect(args[args.indexOf("--disallowedTools") + 1]?.split(",")).toEqual(
      expect.arrayContaining([
        "WebSearch",
        "WebFetch",
        "RemoteTrigger",
        "CronCreate",
        "ScheduleWakeup",
        "SendMessage",
        "Workflow",
      ]),
    );
  });

  test("runs the preinstalled CLI from the runtime cache and never installs or uses an image-provided claude", () => {
    const script = buildClaudeBootstrapScript(["-p", "--model", "claude-opus-5-5"]);

    expect(script).toContain("export IS_SANDBOX=1");
    expect(script).not.toContain("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB");
    expect(script).toContain("export DISABLE_AUTOUPDATER=1");
    expect(script).toContain("export HOME=/tmp/claude-home");
    expect(script).not.toContain("npm install");
    expect(script).toContain("exec /opt/claude-code/bin/claude '-p' '--model' 'claude-opus-5-5'");
    expect(script).not.toContain("command -v claude");
  });

  test("installs the pinned package, checks the CLI version, and makes a one-turn model call in preflight", () => {
    const script = buildClaudePreflightScript(DEFAULT_CLAUDE_CODE_PACKAGE, "claude-opus-5-5");

    expect(script).toContain(
      `npm install --global --prefix /opt/claude-code --no-fund --no-audit --no-update-notifier --loglevel error '${DEFAULT_CLAUDE_CODE_PACKAGE}'`,
    );
    expect(script).toContain("/opt/claude-code/bin/claude --version >&2");
    expect(script).toContain("'--model' 'claude-opus-5-5'");
    expect(script).toContain("'--output-format' 'stream-json'");
  });

  test("requires an exact Claude Code version pin", () => {
    vi.stubEnv("LLM_CHALLENGE_CLAUDE_NPM_PACKAGE", "@anthropic-ai/claude-code@latest");

    expect(() => getClaudeRuntimeConfig("/root")).toThrow("exact version");

    vi.stubEnv("LLM_CHALLENGE_CLAUDE_NPM_PACKAGE", "@anthropic-ai/claude-code@2.1.285");
    expect(getClaudeRuntimeConfig("/root").claudePackage).toBe("@anthropic-ai/claude-code@2.1.285");
  });

  test("derives the pinned version and a per-version install cache", () => {
    expect(parsePinnedVersion(DEFAULT_CLAUDE_CODE_PACKAGE)).toMatch(/^\d+\.\d+\.\d+$/);
    expect(claudeInstallCacheDir("/root", "@anthropic-ai/claude-code@2.1.285")).toBe(
      path.join("/root", ".cache", "claude-code", "anthropic-ai-claude-code-2.1.285"),
    );
  });
});

describe("claude credentials", () => {
  test("prefers the environment token and falls back to the token file", async () => {
    const dir = await makeTempDir();
    const tokenFile = path.join(dir, "token");
    await fs.writeFile(tokenFile, "file-token\n");

    await expect(
      resolveClaudeOAuthToken({ env: { [CLAUDE_OAUTH_TOKEN_ENV]: "env-token" }, tokenFile }),
    ).resolves.toBe("env-token");
    await expect(resolveClaudeOAuthToken({ env: {}, tokenFile })).resolves.toBe("file-token");
  });

  test("explains how to create a missing or empty token", async () => {
    const dir = await makeTempDir();
    const tokenFile = path.join(dir, "token");

    await expect(resolveClaudeOAuthToken({ env: {}, tokenFile })).rejects.toThrow(
      "claude setup-token",
    );
    await fs.writeFile(tokenFile, "\n");
    await expect(resolveClaudeOAuthToken({ env: {}, tokenFile })).rejects.toThrow(
      "claude setup-token",
    );
  });

  test("redacts the token from solver logs", async () => {
    const dir = await makeTempDir();
    const tracePath = path.join(dir, "trace.jsonl");
    const missingPath = path.join(dir, "missing.log");
    await fs.writeFile(tracePath, '{"output":"CLAUDE_CODE_OAUTH_TOKEN=sk-secret sk-secret"}\n');

    await redactSecretInFiles([tracePath, missingPath], "sk-secret");

    await expect(fs.readFile(tracePath, "utf8")).resolves.toBe(
      '{"output":"CLAUDE_CODE_OAUTH_TOKEN=[REDACTED] [REDACTED]"}\n',
    );
  });
});

describe("workspace redaction", () => {
  test("redacts the token from regular workspace files without following symlinks", async () => {
    const dir = await makeTempDir();
    const worktreePath = path.join(dir, "work");
    await fs.mkdir(path.join(worktreePath, "src"), { recursive: true });
    await fs.writeFile(path.join(worktreePath, "src/env.txt"), "token=sk-secret\n");
    await fs.writeFile(path.join(worktreePath, "clean.txt"), "nothing here\n");
    await fs.writeFile(path.join(dir, "outside.txt"), "sk-secret\n");
    await fs.symlink(path.join(dir, "outside.txt"), path.join(worktreePath, "link.txt"));

    await expect(redactSecretInWorkspace(worktreePath, "sk-secret")).resolves.toEqual([
      "src/env.txt",
    ]);

    await expect(fs.readFile(path.join(worktreePath, "src/env.txt"), "utf8")).resolves.toBe(
      "token=[REDACTED]\n",
    );
    await expect(fs.readFile(path.join(dir, "outside.txt"), "utf8")).resolves.toBe("sk-secret\n");
  });
});

describe("solver container", () => {
  test("names the container and passes secrets by environment variable name only", () => {
    const args = buildAgentContainerArgs({
      containerName: "llm-challenge-run-1",
      image: "example.invalid/image:test",
      worktreePath: "/host/work",
      sharedPnpmStorePath: "/host/store",
      mounts: ["/host/cache:/opt/claude-code:rw,z"],
      envNames: [CLAUDE_OAUTH_TOKEN_ENV],
      script: "exec true",
    });

    expect(args.slice(0, 3)).toEqual(["run", "--rm", "-i"]);
    expect(args[args.indexOf("--name") + 1]).toBe("llm-challenge-run-1");
    expect(args).toContain("--init");
    expect(args[args.indexOf("--env") + 1]).toBe(CLAUDE_OAUTH_TOKEN_ENV);
    expect(args).toContain("/host/work:/workspace:rw,Z");
    expect(args).toContain("/host/cache:/opt/claude-code:rw,z");
    expect(args.slice(-3)).toEqual(["example.invalid/image:test", "-lc", "exec true"]);
  });

  test("mounts the workspace read-only when requested", () => {
    const args = buildAgentContainerArgs({
      containerName: "llm-challenge-grade-1",
      image: "example.invalid/image:test",
      worktreePath: "/host/judge-workspace",
      worktreeAccess: "ro",
      mounts: [],
      envNames: [],
      script: "exec true",
    });

    expect(args).toContain("/host/judge-workspace:/workspace:ro,Z");
    expect(args).not.toContain("/host/judge-workspace:/workspace:rw,Z");
  });

  test("removes the container when the solver times out", async () => {
    const dir = await makeTempDir();
    const fakeBinPath = path.join(dir, "bin");
    const callsPath = path.join(dir, "calls.log");
    await fs.mkdir(fakeBinPath, { recursive: true });
    const fakePodmanPath = path.join(fakeBinPath, "podman");
    await fs.writeFile(
      fakePodmanPath,
      `#!/bin/sh\necho "$@" >> ${JSON.stringify(callsPath)}\nif [ "$1" = "run" ]; then exec sleep 30; fi\nexit 0\n`,
    );
    await fs.chmod(fakePodmanPath, 0o755);
    vi.stubEnv("PATH", `${fakeBinPath}${path.delimiter}${process.env.PATH ?? ""}`);

    const result = await runAgentContainer({
      podmanArgs: ["run", "--name", "llm-challenge-timeout"],
      containerName: "llm-challenge-timeout",
      prompt: "task",
      solverStdoutPath: path.join(dir, "stdout.log"),
      solverStderrPath: path.join(dir, "stderr.log"),
      tracePath: path.join(dir, "trace.jsonl"),
      maxSeconds: 0.2,
    });

    expect(result.timedOut).toBe(true);
    const calls = (await fs.readFile(callsPath, "utf8")).trim().split("\n");
    expect(calls).toContain("rm -f llm-challenge-timeout");
  });
});

describe("claude runtime cache", () => {
  async function setUp(options: { installed: boolean }) {
    const dir = await makeTempDir();
    const fakeBinPath = path.join(dir, "bin");
    const argsPath = path.join(dir, "podman-args.json");
    const installCacheDir = path.join(dir, "cache");
    await fs.mkdir(fakeBinPath, { recursive: true });
    await fs.mkdir(path.join(installCacheDir, "bin"), { recursive: true });
    if (options.installed) {
      await fs.writeFile(path.join(installCacheDir, "bin", "claude"), "");
    }
    await fs.mkdir(path.join(dir, "work"), { recursive: true });
    await fs.writeFile(path.join(dir, "prompt.md"), "task");
    const fakePodmanPath = path.join(fakeBinPath, "podman");
    await fs.writeFile(
      fakePodmanPath,
      `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));\n`,
    );
    await fs.chmod(fakePodmanPath, 0o755);
    vi.stubEnv("PATH", `${fakeBinPath}${path.delimiter}${process.env.PATH ?? ""}`);
    const runtime = {
      image: "example.invalid/image:test",
      claudePackage: DEFAULT_CLAUDE_CODE_PACKAGE,
      tokenFile: path.join(dir, "token"),
      installCacheDir,
    };
    const logs = {
      stdoutPath: path.join(dir, "stdout.log"),
      stderrPath: path.join(dir, "stderr.log"),
      tracePath: path.join(dir, "trace.jsonl"),
    };
    const readArgs = async () => JSON.parse(await fs.readFile(argsPath, "utf8")) as string[];
    return { dir, runtime, logs, readArgs, installCacheDir };
  }

  test("mounts the runtime cache read-only into solver and judge containers", async () => {
    const { dir, runtime, logs, readArgs, installCacheDir } = await setUp({ installed: true });

    await runClaudeInPodman({
      containerName: "llm-challenge-solver",
      worktreePath: path.join(dir, "work"),
      promptPath: path.join(dir, "prompt.md"),
      solverStdoutPath: logs.stdoutPath,
      solverStderrPath: logs.stderrPath,
      tracePath: logs.tracePath,
      model: "claude-opus-5-5",
      effort: "xhigh",
      maxSeconds: 30,
      runtime,
      token: "sk-test",
    });
    expect(await readArgs()).toContain(`${installCacheDir}:/opt/claude-code:ro,z`);

    await runJudgeInPodman({
      containerName: "llm-challenge-judge",
      workspaceDir: path.join(dir, "work"),
      evidenceDir: dir,
      prompt: "grade",
      model: "claude-fable-5-1",
      effort: "high",
      schema: {},
      runtime,
      token: "sk-test",
      ...logs,
      maxSeconds: 30,
    });
    expect(await readArgs()).toContain(`${installCacheDir}:/opt/claude-code:ro,z`);
  });

  test("redacts the workspace even when the container fails to start", async () => {
    const { dir, runtime, logs } = await setUp({ installed: true });
    await fs.writeFile(path.join(dir, "work", "leak.txt"), "sk-test\n");
    vi.stubEnv("PATH", path.join(dir, "no-podman"));

    await expect(
      runClaudeInPodman({
        containerName: "llm-challenge-solver",
        worktreePath: path.join(dir, "work"),
        promptPath: path.join(dir, "prompt.md"),
        solverStdoutPath: logs.stdoutPath,
        solverStderrPath: logs.stderrPath,
        tracePath: logs.tracePath,
        model: "claude-opus-5-5",
        effort: "xhigh",
        maxSeconds: 30,
        runtime,
        token: "sk-test",
      }),
    ).rejects.toThrow("ENOENT");
    await expect(fs.readFile(path.join(dir, "work", "leak.txt"), "utf8")).resolves.toBe(
      "[REDACTED]\n",
    );
  });

  test("refuses to start before preflight has installed the CLI", async () => {
    const { dir, runtime, logs } = await setUp({ installed: false });

    await expect(
      runClaudeInPodman({
        containerName: "llm-challenge-solver",
        worktreePath: path.join(dir, "work"),
        promptPath: path.join(dir, "prompt.md"),
        solverStdoutPath: logs.stdoutPath,
        solverStderrPath: logs.stderrPath,
        tracePath: logs.tracePath,
        model: "claude-opus-5-5",
        effort: "xhigh",
        maxSeconds: 30,
        runtime,
        token: "sk-test",
      }),
    ).rejects.toThrow("preflight");
  });
});
