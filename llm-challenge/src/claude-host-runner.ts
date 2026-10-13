import { promises as fs } from "node:fs";
import path from "node:path";
import {
  assertClaudeInstalled,
  buildClaudeSolverArgs,
  evaluateClaudePreflight,
  type ClaudePreflightResult,
  type ClaudeRuntimeConfig,
} from "./claude-runner";
import { buildClaudeJudgeArgs } from "./judge";
import { runCommand } from "./process";
import { runAgentProcess, type SolverResult } from "./runner";
import { pathExists } from "./utils";

const HOST_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
];
const HOST_HIDDEN_HOME_PATHS = [
  "~/.ssh",
  "~/.aws",
  "~/.config",
  "~/.claude",
  "~/.claude.json",
  "~/.codex",
  "~/.gnupg",
  "~/.kube",
  "~/.docker",
  "~/.npmrc",
  "~/.netrc",
  "~/.zsh_history",
  "~/.bash_history",
  "~/.zshrc",
  "~/.zshenv",
  "~/.zprofile",
  "~/.bashrc",
  "~/.profile",
  "~/.gitconfig",
  "~/.git-credentials",
  "~/Desktop",
  "~/Documents",
  "~/Downloads",
  "~/Library/Keychains",
  "~/Library/Application Support",
  "~/Library/Cookies",
  "~/Library/Mail",
  "~/Library/Messages",
  "~/Library/Safari",
];

export type HostSettings = {
  permissions: { allow: string[] };
  sandbox: {
    enabled: true;
    autoAllowBashIfSandboxed: true;
    allowUnsandboxedCommands: false;
    failIfUnavailable: true;
    filesystem: { denyRead: string[]; allowRead: string[]; allowWrite: string[] };
    network: { allowedDomains: never[]; strictAllowlist: true };
  };
};

export function buildHostVerifierProfile(options: {
  homeDir: string;
  repoRoot: string;
  worktreePath: string;
  typescriptPath: string;
}): string {
  const deny = [
    ...HOST_HIDDEN_HOME_PATHS.map((hidden) => hidden.replace(/^~/, options.homeDir)),
    options.repoRoot,
  ];
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    '(allow file-write* (literal "/dev/null"))',
    ...deny.map((target) => `(deny file-read* (subpath ${JSON.stringify(target)}))`),
    ...[options.worktreePath, options.typescriptPath].map(
      (target) => `(allow file-read* (subpath ${JSON.stringify(target)}))`,
    ),
  ].join("\n");
}

export function detectReadableToolchainPaths(env: NodeJS.ProcessEnv): string[] {
  return (env.PATH ?? "").split(path.delimiter).some((entry) => /[\\/]mise[\\/]shims$/.test(entry))
    ? ["~/.config/mise"]
    : [];
}

export function buildHostEnv(
  env: NodeJS.ProcessEnv,
  extra: Record<string, string> = {},
): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const key of HOST_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) {
      filtered[key] = value;
    }
  }
  return { ...filtered, ...extra };
}

export function buildHostSettings(options: {
  repoRoot: string;
  worktreePath: string;
  sharedPnpmStorePath?: string;
  readableHomePaths?: string[];
}): HostSettings {
  const store = options.sharedPnpmStorePath === undefined ? [] : [options.sharedPnpmStorePath];
  return {
    permissions: {
      allow: ["Bash", `Read(/${options.worktreePath}/**)`, `Edit(/${options.worktreePath}/**)`],
    },
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
      filesystem: {
        denyRead: [options.repoRoot, ...HOST_HIDDEN_HOME_PATHS],
        allowRead: [options.worktreePath, ...store, ...(options.readableHomePaths ?? [])],
        allowWrite: store,
      },
      network: { allowedDomains: [], strictAllowlist: true },
    },
  };
}

export function buildClaudeHostArgs(options: {
  model: string;
  effort: string;
  settings: HostSettings;
}): string[] {
  return [
    ...buildClaudeSolverArgs({
      model: options.model,
      effort: options.effort,
      permissionMode: "default",
    }),
    "--safe-mode",
    "--settings",
    JSON.stringify(options.settings),
  ];
}

export async function runClaudeOnHost(options: {
  repoRoot: string;
  worktreePath: string;
  promptPath: string;
  solverStdoutPath: string;
  solverStderrPath: string;
  tracePath: string;
  model: string;
  effort: string;
  maxSeconds: number;
  sharedPnpmStorePath?: string;
  runtime: ClaudeRuntimeConfig;
}): Promise<SolverResult> {
  await assertClaudeInstalled(options.runtime);
  const worktreePath = await fs.realpath(options.worktreePath);
  const settings = buildHostSettings({
    repoRoot: await fs.realpath(options.repoRoot),
    worktreePath,
    sharedPnpmStorePath:
      options.sharedPnpmStorePath === undefined
        ? undefined
        : await fs.realpath(options.sharedPnpmStorePath),
    readableHomePaths: detectReadableToolchainPaths(process.env),
  });
  await Promise.all([
    fs.writeFile(options.solverStdoutPath, ""),
    fs.writeFile(options.solverStderrPath, ""),
    fs.writeFile(options.tracePath, ""),
  ]);
  return await runAgentProcess({
    command: path.join(options.runtime.installCacheDir, "bin", "claude"),
    args: buildClaudeHostArgs({ model: options.model, effort: options.effort, settings }),
    prompt: await fs.readFile(options.promptPath, "utf8"),
    solverStdoutPath: options.solverStdoutPath,
    solverStderrPath: options.solverStderrPath,
    tracePath: options.tracePath,
    maxSeconds: options.maxSeconds,
    cwd: worktreePath,
    env: buildHostEnv(
      process.env,
      options.sharedPnpmStorePath === undefined
        ? {}
        : { PNPM_CONFIG_STORE_DIR: options.sharedPnpmStorePath },
    ),
    replaceEnv: true,
    killProcessGroup: true,
  });
}

export function assertHostRuntimeSupported(platform: NodeJS.Platform = process.platform): void {
  if (platform !== "darwin") {
    throw new Error(
      "--runtime host needs macOS, where the type check is confined with sandbox-exec; use --runtime podman",
    );
  }
}

export async function preflightClaudeOnHost(options: {
  runtime: ClaudeRuntimeConfig;
  model: string;
}): Promise<ClaudePreflightResult> {
  const { installCacheDir, claudePackage } = options.runtime;
  const binary = path.join(installCacheDir, "bin", "claude");
  await fs.mkdir(installCacheDir, { recursive: true });
  const startedAt = Date.now();
  if (!(await pathExists(binary))) {
    const install = await runCommand(
      "npm",
      [
        "install",
        "--global",
        "--prefix",
        installCacheDir,
        "--no-fund",
        "--no-audit",
        "--no-update-notifier",
        "--loglevel",
        "error",
        claudePackage,
      ],
      { rejectOnNonZero: false },
    );
    if (install.exitCode !== 0) {
      return {
        skipped: false,
        exitCode: install.exitCode ?? 1,
        durationMs: Date.now() - startedAt,
        stderr: install.stderr,
      };
    }
  }
  const version = await runCommand(binary, ["--version"], { rejectOnNonZero: false });
  const probe = await runCommand(
    binary,
    [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      options.model,
      "--tools",
      "",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--safe-mode",
    ],
    { input: "Reply with exactly: ok", rejectOnNonZero: false },
  );
  return evaluateClaudePreflight({
    runtime: options.runtime,
    model: options.model,
    exitCode: version.exitCode === 0 ? probe.exitCode : version.exitCode,
    stdout: probe.stdout,
    stderr: `${version.stdout}\n${version.stderr}\n${probe.stderr}`,
    durationMs: Date.now() - startedAt,
  });
}

export async function runJudgeOnHost(options: {
  workspaceDir: string;
  evidenceDir: string;
  prompt: string;
  model: string;
  effort: string;
  schema: Record<string, unknown>;
  runtime: ClaudeRuntimeConfig;
  stdoutPath: string;
  stderrPath: string;
  tracePath: string;
  maxSeconds: number;
}): Promise<SolverResult> {
  await assertClaudeInstalled(options.runtime);
  const evidenceDir = await fs.realpath(options.evidenceDir);
  const workspaceDir = await fs.realpath(options.workspaceDir);
  await Promise.all([
    fs.writeFile(options.stdoutPath, ""),
    fs.writeFile(options.stderrPath, ""),
    fs.writeFile(options.tracePath, ""),
  ]);
  return await runAgentProcess({
    command: path.join(options.runtime.installCacheDir, "bin", "claude"),
    args: buildClaudeJudgeArgs({
      model: options.model,
      effort: options.effort,
      schema: options.schema,
      evidenceDir,
    }),
    prompt: options.prompt,
    solverStdoutPath: options.stdoutPath,
    solverStderrPath: options.stderrPath,
    tracePath: options.tracePath,
    maxSeconds: options.maxSeconds,
    cwd: workspaceDir,
    env: buildHostEnv(process.env),
    replaceEnv: true,
    killProcessGroup: true,
  });
}

export async function installWorkspaceDepsOnHost(options: {
  worktreePath: string;
  sharedPnpmStorePath?: string;
}): Promise<void> {
  await runCommand("pnpm", ["install", "--ignore-scripts"], {
    cwd: await fs.realpath(options.worktreePath),
    env: buildHostEnv(
      process.env,
      options.sharedPnpmStorePath === undefined
        ? {}
        : { PNPM_CONFIG_STORE_DIR: options.sharedPnpmStorePath },
    ),
  });
}
