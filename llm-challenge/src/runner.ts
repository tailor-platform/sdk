import { spawn } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type SolverResult = {
  exitCode?: number;
  durationMs: number;
  timedOut: boolean;
};

export async function runCodexInPodman(options: {
  worktreePath: string;
  promptPath: string;
  solverStdoutPath: string;
  solverStderrPath: string;
  tracePath: string;
  model: string;
  effort: string;
  maxSeconds: number;
}): Promise<SolverResult> {
  const authFile =
    process.env.LLM_CHALLENGE_CODEX_AUTH_FILE ?? path.join(os.homedir(), ".codex", "auth.json");
  await fs.access(authFile);
  await Promise.all([
    fs.writeFile(options.solverStdoutPath, ""),
    fs.writeFile(options.solverStderrPath, ""),
    fs.writeFile(options.tracePath, ""),
  ]);

  const image = process.env.LLM_CHALLENGE_CODEX_IMAGE ?? "ghcr.io/openai/codex-universal:latest";
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
  const script = [
    "set -eu",
    "mkdir -p /tmp/codex-home",
    "cp /tmp/codex-auth.json /tmp/codex-home/auth.json",
    "export CODEX_HOME=/tmp/codex-home",
    `exec codex ${codexArgs.map(shellQuote).join(" ")}`,
  ].join("\n");
  const prompt = await fs.readFile(options.promptPath, "utf8");
  const podmanArgs = [
    "run",
    "--rm",
    "-i",
    "--entrypoint",
    "/bin/sh",
    "-v",
    `${options.worktreePath}:/workspace:rw`,
    "-v",
    `${authFile}:/tmp/codex-auth.json:ro`,
    "-w",
    "/workspace",
    image,
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
