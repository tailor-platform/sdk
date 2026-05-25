import { spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

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
export const CONTAINER_PNPM_STORE = "/workspace/.pnpm-store";

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
  const result = await runProcess("podman", podmanArgs);
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
  await Promise.all([
    fs.writeFile(options.solverStdoutPath, ""),
    fs.writeFile(options.solverStderrPath, ""),
    fs.writeFile(options.tracePath, ""),
  ]);

  const codexArgs = [
    "--search",
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
  const script = buildCodexBootstrapScript(codexArgs, runtime.codexPackage);
  const prompt = await fs.readFile(options.promptPath, "utf8");
  const podmanArgs = [
    "run",
    "--rm",
    "-i",
    "--entrypoint",
    "/bin/bash",
    "-v",
    `${options.worktreePath}:/workspace:rw,Z`,
    ...(options.sharedPnpmStorePath === undefined
      ? []
      : [
          "-v",
          `${options.sharedPnpmStorePath}:${CONTAINER_PNPM_STORE}:rw,z`,
          "-e",
          `NPM_CONFIG_STORE_DIR=${CONTAINER_PNPM_STORE}`,
        ]),
    "-v",
    `${runtime.authFile}:/tmp/codex-auth.json:ro,Z`,
    "-w",
    "/workspace",
    runtime.image,
    "-lc",
    script,
  ];

  const startedAt = Date.now();
  return await new Promise((resolve, reject) => {
    const child = spawn("podman", podmanArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = createWriteStream(options.solverStdoutPath, { flags: "a" });
    const stderr = createWriteStream(options.solverStderrPath, { flags: "a" });
    const trace = createWriteStream(options.tracePath, { flags: "a" });
    let timedOut = false;
    let settled = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
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
    child.stdin.end(prompt);
  });
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

function shellQuote(value: string): string {
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

async function runProcess(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
      });
    });
  });
}

function firstCodexVersionLine(stdout: string): string | undefined {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("codex-cli "));
}
