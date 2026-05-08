import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type RunCliOptions = {
  command: string;
  args: string[];
  /** Text piped to stdin. */
  stdin?: string;
  /** Working directory; defaults to a fresh empty tmpdir to avoid CLAUDE.md / skills auto-discovery. */
  cwd?: string;
  /** Hard timeout in ms. */
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

export type RunCliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export function makeIsolatedCwd(label = "llm-eval-"): string {
  return mkdtempSync(join(tmpdir(), label));
}

export async function runCli(opts: RunCliOptions): Promise<RunCliResult> {
  const cwd = opts.cwd ?? makeIsolatedCwd();
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;

  return new Promise((resolve, reject) => {
    const child = spawn(opts.command, opts.args, {
      cwd,
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (b) => stdoutChunks.push(b));
    child.stderr.on("data", (b) => stderrChunks.push(b));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`runCli: timeout after ${timeoutMs}ms (${opts.command})`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });

    if (opts.stdin) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}
