import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findServedModelMismatches, summarizeClaudeTrace } from "./claude-trace";
import { runCommand } from "./process";
import {
  DEFAULT_CODEX_IMAGE,
  buildAgentContainerArgs,
  runAgentContainer,
  shellQuote,
  type SolverResult,
} from "./runner";
import { parseJsonLines, toPosix } from "./utils";
import { listWorkspaceFiles } from "./workspace-files";

export const DEFAULT_CLAUDE_CODE_PACKAGE = "@anthropic-ai/claude-code@2.1.285";
export const CLAUDE_OAUTH_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";
const CONTAINER_CLAUDE_PREFIX = "/opt/claude-code";
const CONTAINER_CLAUDE_BIN = `${CONTAINER_CLAUDE_PREFIX}/bin/claude`;
const SOLVER_DISALLOWED_TOOLS = [
  "WebSearch",
  "WebFetch",
  "RemoteTrigger",
  "CronCreate",
  "CronDelete",
  "CronList",
  "ScheduleWakeup",
  "SendMessage",
  "ListAgents",
  "Workflow",
];
const REDACTED = "[REDACTED]";
const WORKSPACE_REDACTION_BYTES_LIMIT = 10 * 1024 * 1024;

export type ClaudeRuntimeConfig = {
  image: string;
  claudePackage: string;
  tokenFile: string;
  installCacheDir: string;
};

export type ClaudePreflightResult = {
  skipped: boolean;
  exitCode?: number;
  durationMs?: number;
  stderr?: string;
  claudeVersion?: string;
};

export function getClaudeRuntimeConfig(packageRoot: string): ClaudeRuntimeConfig {
  const claudePackage = process.env.LLM_CHALLENGE_CLAUDE_NPM_PACKAGE ?? DEFAULT_CLAUDE_CODE_PACKAGE;
  if (!/^\d+\.\d+\.\d+$/.test(parsePinnedVersion(claudePackage) ?? "")) {
    throw new Error(
      `LLM_CHALLENGE_CLAUDE_NPM_PACKAGE must pin an exact version such as ${DEFAULT_CLAUDE_CODE_PACKAGE}, got ${claudePackage}`,
    );
  }
  return {
    image: process.env.LLM_CHALLENGE_CLAUDE_IMAGE ?? DEFAULT_CODEX_IMAGE,
    claudePackage,
    tokenFile:
      process.env.LLM_CHALLENGE_CLAUDE_OAUTH_TOKEN_FILE ??
      path.join(os.homedir(), ".config", "llm-challenge", "claude-oauth-token"),
    installCacheDir: claudeInstallCacheDir(packageRoot, claudePackage),
  };
}

export function claudeInstallCacheDir(packageRoot: string, claudePackage: string): string {
  const name = claudePackage.replace(/^@/, "").replaceAll(/[^A-Za-z0-9._-]+/g, "-");
  return path.join(packageRoot, ".cache", "claude-code", name);
}

export function parsePinnedVersion(claudePackage: string): string | undefined {
  const atIndex = claudePackage.lastIndexOf("@");
  return atIndex > 0 ? claudePackage.slice(atIndex + 1) : undefined;
}

export async function resolveClaudeOAuthToken(options: {
  env: NodeJS.ProcessEnv;
  tokenFile: string;
}): Promise<string> {
  const fromEnv = options.env[CLAUDE_OAUTH_TOKEN_ENV]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  let fromFile = "";
  try {
    fromFile = (await fs.readFile(options.tokenFile, "utf8")).trim();
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  if (fromFile.length === 0) {
    throw new Error(
      `Claude credentials not found. Run \`claude setup-token\` and save the token to ${options.tokenFile}, or set ${CLAUDE_OAUTH_TOKEN_ENV}.`,
    );
  }
  return fromFile;
}

export function buildClaudeSolverArgs(options: { model: string; effort: string }): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    options.model,
    "--effort",
    options.effort,
    "--permission-mode",
    "bypassPermissions",
    "--disallowedTools",
    SOLVER_DISALLOWED_TOOLS.join(","),
    "--strict-mcp-config",
    "--no-session-persistence",
  ];
}

export function buildClaudeBootstrapScript(claudeArgs: string[]): string {
  return [
    ...claudeEnvironmentLines(),
    `exec ${CONTAINER_CLAUDE_BIN} ${claudeArgs.map(shellQuote).join(" ")}`,
  ].join("\n");
}

export function buildClaudePreflightScript(claudePackage: string, model: string): string {
  const probeArgs = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    model,
    "--tools",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
  ];
  return [
    ...claudeEnvironmentLines(),
    `if [ ! -x ${CONTAINER_CLAUDE_BIN} ]; then`,
    `  npm install --global --prefix ${CONTAINER_CLAUDE_PREFIX} --no-fund --no-audit --no-update-notifier --loglevel error ${shellQuote(claudePackage)} >&2`,
    "fi",
    `${CONTAINER_CLAUDE_BIN} --version >&2`,
    `printf 'Reply with exactly: ok' | exec ${CONTAINER_CLAUDE_BIN} ${probeArgs.map(shellQuote).join(" ")}`,
  ].join("\n");
}

function claudeEnvironmentLines(): string[] {
  return [
    "set -eu",
    "export HOME=/tmp/claude-home",
    'mkdir -p "$HOME"',
    "export IS_SANDBOX=1",
    "export DISABLE_AUTOUPDATER=1",
    "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
  ];
}

export function claudeRuntimeMount(runtime: ClaudeRuntimeConfig): string {
  return `${runtime.installCacheDir}:${CONTAINER_CLAUDE_PREFIX}:ro,z`;
}

export async function assertClaudeInstalled(runtime: ClaudeRuntimeConfig): Promise<void> {
  try {
    await fs.access(path.join(runtime.installCacheDir, "bin", "claude"));
  } catch {
    throw new Error(
      `Claude Code is not installed in ${runtime.installCacheDir}; run once without --no-preflight to install ${runtime.claudePackage}`,
    );
  }
}

export async function preflightClaudeRunner(options: {
  runtime: ClaudeRuntimeConfig;
  token: string;
  model: string;
}): Promise<ClaudePreflightResult> {
  await fs.mkdir(options.runtime.installCacheDir, { recursive: true });
  const startedAt = Date.now();
  const result = await runCommand(
    "podman",
    [
      "run",
      "--rm",
      "--init",
      "--entrypoint",
      "/bin/bash",
      "-v",
      `${options.runtime.installCacheDir}:${CONTAINER_CLAUDE_PREFIX}:rw,z`,
      "--env",
      CLAUDE_OAUTH_TOKEN_ENV,
      options.runtime.image,
      "-lc",
      buildClaudePreflightScript(options.runtime.claudePackage, options.model),
    ],
    { env: { [CLAUDE_OAUTH_TOKEN_ENV]: options.token }, rejectOnNonZero: false },
  );
  const stderr = redactSecret(result.stderr, options.token);
  const claudeVersion = /(\d+\.\d+\.\d+) \(Claude Code\)/.exec(stderr)?.[1];
  const trace = summarizeClaudeTrace(parseJsonLines(result.stdout));
  const problems: string[] = [];
  const pinnedVersion = parsePinnedVersion(options.runtime.claudePackage);
  if (pinnedVersion !== undefined && claudeVersion !== pinnedVersion) {
    problems.push(`expected Claude Code ${pinnedVersion}, got ${claudeVersion ?? "unknown"}`);
  }
  if (trace.result === undefined || trace.result.isError === true) {
    problems.push(
      `model probe failed${trace.result?.apiErrorStatus ? ` (API status ${trace.result.apiErrorStatus})` : ""}${
        trace.result?.errorText ? `: ${trace.result.errorText}` : ""
      }`,
    );
  }
  const mismatches = findServedModelMismatches(options.model, trace.servedModels);
  if (mismatches.length > 0) {
    problems.push(`requested ${options.model} but the response came from ${mismatches.join(", ")}`);
  }
  return {
    skipped: false,
    exitCode: result.exitCode === 0 && problems.length > 0 ? 1 : (result.exitCode ?? undefined),
    durationMs: Date.now() - startedAt,
    stderr: [...problems, stderr.trim()].filter(Boolean).join("\n"),
    claudeVersion,
  };
}

export async function runClaudeInPodman(options: {
  containerName: string;
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
  token: string;
}): Promise<SolverResult> {
  await assertClaudeInstalled(options.runtime);
  try {
    return await runAgentContainer({
      podmanArgs: buildAgentContainerArgs({
        containerName: options.containerName,
        image: options.runtime.image,
        worktreePath: options.worktreePath,
        sharedPnpmStorePath: options.sharedPnpmStorePath,
        mounts: [claudeRuntimeMount(options.runtime)],
        envNames: [CLAUDE_OAUTH_TOKEN_ENV],
        script: buildClaudeBootstrapScript(
          buildClaudeSolverArgs({ model: options.model, effort: options.effort }),
        ),
      }),
      containerName: options.containerName,
      prompt: await fs.readFile(options.promptPath, "utf8"),
      solverStdoutPath: options.solverStdoutPath,
      solverStderrPath: options.solverStderrPath,
      tracePath: options.tracePath,
      maxSeconds: options.maxSeconds,
      env: { [CLAUDE_OAUTH_TOKEN_ENV]: options.token },
    });
  } finally {
    await redactSecretInFiles(
      [options.solverStdoutPath, options.solverStderrPath, options.tracePath],
      options.token,
    );
    await redactSecretInWorkspace(options.worktreePath, options.token);
  }
}

export async function redactSecretInWorkspace(
  worktreePath: string,
  secret: string,
): Promise<string[]> {
  const redacted: string[] = [];
  for (const relativePath of await listWorkspaceFiles(worktreePath)) {
    const filePath = path.join(worktreePath, relativePath);
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.size > WORKSPACE_REDACTION_BYTES_LIMIT) {
      continue;
    }
    const contents = await fs.readFile(filePath, "utf8");
    if (contents.includes(secret)) {
      await fs.writeFile(filePath, redactSecret(contents, secret));
      redacted.push(toPosix(relativePath));
    }
  }
  return redacted;
}

export async function redactSecretInFiles(filePaths: string[], secret: string): Promise<void> {
  await Promise.all(
    filePaths.map(async (filePath) => {
      let contents: string;
      try {
        contents = await fs.readFile(filePath, "utf8");
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return;
        }
        throw error;
      }
      if (contents.includes(secret)) {
        await fs.writeFile(filePath, redactSecret(contents, secret));
      }
    }),
  );
}

function redactSecret(value: string, secret: string): string {
  return secret.length === 0 ? value : value.replaceAll(secret, REDACTED);
}
