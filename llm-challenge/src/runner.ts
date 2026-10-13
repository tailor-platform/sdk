import { spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./process";

export type SolverResult = {
  exitCode?: number;
  durationMs: number;
  timedOut: boolean;
};

export type CodexRuntimeConfig = {
  image: string;
  codexPackage: string;
  authFile: string;
};

export type CodexPreflightResult = {
  skipped: boolean;
  exitCode?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  codexVersion?: string;
};

export const DEFAULT_CODEX_IMAGE =
  "ghcr.io/openai/codex-universal@sha256:905e512f36460e1be4cfedb30928a8a28299edb0fcd5de7998ceaa72d27fe304";
export const DEFAULT_CODEX_NPM_PACKAGE = "@openai/codex@0.133.0";
export const CONTAINER_WORKSPACE_DIR = "/workspace";
export const CONTAINER_PNPM_STORE = "/pnpm-store";
export const PNPM_STORE_ENV = "PNPM_CONFIG_STORE_DIR";

export function getCodexRuntimeConfig(): CodexRuntimeConfig {
  return {
    image: process.env.LLM_CHALLENGE_CODEX_IMAGE ?? DEFAULT_CODEX_IMAGE,
    codexPackage: process.env.LLM_CHALLENGE_CODEX_NPM_PACKAGE ?? DEFAULT_CODEX_NPM_PACKAGE,
    authFile:
      process.env.LLM_CHALLENGE_CODEX_AUTH_FILE ?? path.join(os.homedir(), ".codex", "auth.json"),
  };
}

export async function preflightCodexRunner(
  runtime = getCodexRuntimeConfig(),
): Promise<CodexPreflightResult> {
  await fs.access(runtime.authFile);
  const startedAt = Date.now();
  const script = buildCodexPreflightScript(runtime.codexPackage);
  const podmanArgs = [
    "run",
    "--rm",
    "--entrypoint",
    "/bin/bash",
    "-v",
    `${runtime.authFile}:/tmp/codex-auth.json:ro,Z`,
    runtime.image,
    "-lc",
    script,
  ];
  const result = await runCommand("podman", podmanArgs, { rejectOnNonZero: false });
  const codexVersion = firstCodexVersionLine(result.stdout);
  return {
    skipped: false,
    exitCode: result.exitCode ?? undefined,
    durationMs: Date.now() - startedAt,
    stdout: result.stdout,
    stderr: result.stderr,
    codexVersion,
  };
}

export async function runCodexInPodman(options: {
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
  runtime?: CodexRuntimeConfig;
}): Promise<SolverResult> {
  const runtime = options.runtime ?? getCodexRuntimeConfig();
  await fs.access(runtime.authFile);
  const codexArgs = buildCodexExecArgs({
    model: options.model,
    effort: options.effort,
  });
  return await runAgentContainer({
    podmanArgs: buildAgentContainerArgs({
      containerName: options.containerName,
      image: runtime.image,
      worktreePath: options.worktreePath,
      sharedPnpmStorePath: options.sharedPnpmStorePath,
      mounts: [`${runtime.authFile}:/tmp/codex-auth.json:ro,Z`],
      envNames: [],
      script: buildCodexBootstrapScript(codexArgs, runtime.codexPackage),
    }),
    containerName: options.containerName,
    prompt: await fs.readFile(options.promptPath, "utf8"),
    solverStdoutPath: options.solverStdoutPath,
    solverStderrPath: options.solverStderrPath,
    tracePath: options.tracePath,
    maxSeconds: options.maxSeconds,
  });
}

export function buildAgentContainerArgs(options: {
  containerName: string;
  image: string;
  worktreePath: string;
  worktreeAccess?: "rw" | "ro";
  sharedPnpmStorePath?: string;
  mounts: string[];
  envNames: string[];
  script: string;
}): string[] {
  return [
    "run",
    "--rm",
    "-i",
    "--init",
    "--name",
    options.containerName,
    "--entrypoint",
    "/bin/bash",
    "-v",
    `${options.worktreePath}:${CONTAINER_WORKSPACE_DIR}:${options.worktreeAccess ?? "rw"},Z`,
    ...(options.sharedPnpmStorePath === undefined
      ? []
      : [
          "-v",
          `${options.sharedPnpmStorePath}:${CONTAINER_PNPM_STORE}:rw,z`,
          "-e",
          `${PNPM_STORE_ENV}=${CONTAINER_PNPM_STORE}`,
        ]),
    ...options.mounts.flatMap((mount) => ["-v", mount]),
    ...options.envNames.flatMap((name) => ["--env", name]),
    "-w",
    CONTAINER_WORKSPACE_DIR,
    options.image,
    "-lc",
    options.script,
  ];
}

export async function runAgentContainer(options: {
  podmanArgs: string[];
  containerName: string;
  prompt: string;
  solverStdoutPath: string;
  solverStderrPath: string;
  tracePath: string;
  maxSeconds: number;
  env?: Record<string, string>;
}): Promise<SolverResult> {
  return await runAgentProcess({
    command: "podman",
    args: options.podmanArgs,
    prompt: options.prompt,
    solverStdoutPath: options.solverStdoutPath,
    solverStderrPath: options.solverStderrPath,
    tracePath: options.tracePath,
    maxSeconds: options.maxSeconds,
    env: options.env,
    onTimeout: async () => {
      await runCommand("podman", ["rm", "-f", options.containerName], {
        rejectOnNonZero: false,
      }).catch(() => undefined);
    },
  });
}

export async function runAgentProcess(options: {
  command: string;
  args: string[];
  prompt: string;
  solverStdoutPath: string;
  solverStderrPath: string;
  tracePath: string;
  maxSeconds: number;
  env?: Record<string, string>;
  /** Use `env` as the whole environment instead of layering it over this process's. */
  replaceEnv?: boolean;
  cwd?: string;
  /** Start the child as a process group leader and signal the group, so its descendants die with it. */
  killProcessGroup?: boolean;
  onTimeout?: () => Promise<void>;
}): Promise<SolverResult> {
  await Promise.all([
    fs.writeFile(options.solverStdoutPath, ""),
    fs.writeFile(options.solverStderrPath, ""),
    fs.writeFile(options.tracePath, ""),
  ]);

  const startedAt = Date.now();
  const result = await new Promise<SolverResult>((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env:
        options.env === undefined
          ? undefined
          : options.replaceEnv
            ? options.env
            : { ...process.env, ...options.env },
      detached: options.killProcessGroup,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const signal = (name: NodeJS.Signals) => {
      if (options.killProcessGroup && child.pid !== undefined) {
        try {
          process.kill(-child.pid, name);
        } catch {
          child.kill(name);
        }
      } else {
        child.kill(name);
      }
    };
    const stdout = createWriteStream(options.solverStdoutPath, { flags: "a" });
    const stderr = createWriteStream(options.solverStderrPath, { flags: "a" });
    const trace = createWriteStream(options.tracePath, { flags: "a" });
    let timedOut = false;
    let settled = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      signal("SIGTERM");
      setTimeout(() => signal("SIGKILL"), 5_000).unref();
    }, options.maxSeconds * 1000);
    timeout.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.write(chunk);
      trace.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.write(chunk);
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      closeStreams(stdout, stderr, trace).then(() => reject(error), reject);
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      closeStreams(stdout, stderr, trace).then(
        () =>
          resolve({
            exitCode: exitCode ?? undefined,
            durationMs: Date.now() - startedAt,
            timedOut,
          }),
        reject,
      );
    });
    child.stdin.end(options.prompt);
  });
  if (result.timedOut) {
    await options.onTimeout?.();
  }
  return result;
}

export function buildCodexExecArgs(options: { model: string; effort: string }): string[] {
  return [
    "exec",
    "--json",
    "--model",
    options.model,
    "-c",
    `model_reasoning_effort="${options.effort}"`,
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--dangerously-bypass-approvals-and-sandbox",
    "-C",
    "/workspace",
    "-",
  ];
}

export function buildCodexBootstrapScript(codexArgs: string[], codexPackage: string): string {
  const quotedArgs = codexArgs.map(shellQuote).join(" ");
  return [
    "set -eu",
    "mkdir -p /tmp/codex-home",
    "cp /tmp/codex-auth.json /tmp/codex-home/auth.json",
    "export CODEX_HOME=/tmp/codex-home",
    "if command -v codex >/dev/null 2>&1; then",
    `  exec codex ${quotedArgs}`,
    "fi",
    "if ! command -v npm >/dev/null 2>&1; then",
    '  echo "codex CLI is not installed and npm is unavailable to install it" >&2',
    "  exit 127",
    "fi",
    `exec npm exec --yes --no-update-notifier --loglevel error --package ${shellQuote(codexPackage)} -- codex ${quotedArgs}`,
  ].join("\n");
}

export function buildCodexPreflightScript(codexPackage: string): string {
  return [
    "set -eu",
    "mkdir -p /tmp/codex-home",
    "cp /tmp/codex-auth.json /tmp/codex-home/auth.json",
    "export CODEX_HOME=/tmp/codex-home",
    "if command -v codex >/dev/null 2>&1; then",
    "  exec codex --version",
    "fi",
    "if ! command -v npm >/dev/null 2>&1; then",
    '  echo "codex CLI is not installed and npm is unavailable to install it" >&2',
    "  exit 127",
    "fi",
    `exec npm exec --yes --no-update-notifier --loglevel error --package ${shellQuote(codexPackage)} -- codex --version`,
  ].join("\n");
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function closeStreams(...streams: NodeJS.WritableStream[]): Promise<void> {
  await Promise.all(
    streams.map(
      (stream) =>
        new Promise<void>((resolve, reject) => {
          stream.end((error?: Error | null) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        }),
    ),
  );
}

function firstCodexVersionLine(stdout: string): string | undefined {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("codex-cli "));
}
