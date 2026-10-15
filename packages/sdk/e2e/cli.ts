/**
 * Runs CLI subprocesses for e2e tests without blocking the test worker.
 *
 * A synchronous spawn stalls the worker's event loop for the whole call, so
 * Vitest timeouts cannot fire and the worker's Platform connections go stale.
 * Every child line is logged as it arrives, and each run reports how much of
 * its budget it used, warning on GitHub Actions once that share gets high.
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

const tailorBin = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "bin",
  "tailor.mjs",
);

/** Budgets for CLI calls: local commands, plain deploys, and deploys that run data migrations. */
export const CLI_BUDGET_MS = {
  local: 120_000,
  deploy: 300_000,
  migratingDeploy: 900_000,
} as const;

/** Room a test keeps beyond its CLI budgets for killing a child and for its own RPCs and assertions. */
export const CLI_TEST_TIMEOUT_MARGIN_MS = 60_000;

const BUDGET_WARNING_RATIO = 0.6;
const DEFAULT_KILL_GRACE_MS = 10_000;
const CLOSE_WAIT_MS = 5_000;
const DEFAULT_MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
const ERROR_TAIL_LINES = 50;
const ERROR_TAIL_BYTES = 8 * 1024;

export interface ProcessOptions {
  cwd: string;
  /** Prefix for logged lines and the budget report. */
  label: string;
  /** The child is killed and the call rejects once this budget runs out. */
  timeoutMs: number;
  /** Layered over the parent environment; `undefined` removes a variable. */
  env?: Record<string, string | undefined>;
  killGraceMs?: number;
  maxCaptureBytes?: number;
}

export type CliOptions = Omit<ProcessOptions, "label" | "killGraceMs" | "maxCaptureBytes">;

export interface CliResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** stdout and stderr in the order they were received. */
  output: string;
  durationMs: number;
}

export class CliTimeoutError extends Error {
  constructor(
    label: string,
    timeoutMs: number,
    readonly killSignal: NodeJS.Signals,
    readonly output: string,
  ) {
    super(
      `${label} exceeded its ${formatSeconds(timeoutMs)}s budget and was killed with ${killSignal}.\n${outputTail(output)}`,
    );
    this.name = "CliTimeoutError";
  }
}

/**
 * Timeout for a test from the CLI budgets it spends, so a CLI call always times out before the test does.
 * @param budgetsMs - Budget of each CLI call the test makes
 * @returns Test timeout in milliseconds
 */
export function cliTestTimeout(...budgetsMs: number[]): number {
  return budgetsMs.reduce((sum, budget) => sum + budget, 0) + CLI_TEST_TIMEOUT_MARGIN_MS;
}

/**
 * Run a command to completion, resolving for any exit status.
 * @param command - Executable to spawn
 * @param args - Arguments for the executable
 * @param options - Working directory, label, budget, and environment
 * @returns Captured output and exit status
 */
export function tryProcess(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<CliResult> {
  const {
    cwd,
    label,
    timeoutMs,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
    maxCaptureBytes = DEFAULT_MAX_CAPTURE_BYTES,
  } = options;
  const startedAt = performance.now();
  const elapsedMs = () => performance.now() - startedAt;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: mergeEnv(options.env),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const captured = { stdout: "", stderr: "", output: "" };
    let capturedBytes = 0;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let killSignal: NodeJS.Signals | undefined;
    let failure: (() => Error) | undefined;
    let settled = false;
    const timers = new Set<NodeJS.Timeout>();

    const schedule = (run: () => void, delayMs: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        run();
      }, delayMs);
      timers.add(timer);
    };

    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      child.stdout.destroy();
      child.stderr.destroy();
      finish();
    };

    const sendSignal = (signal: NodeJS.Signals) => {
      killSignal = signal;
      child.kill(signal);
    };

    const terminate = (error: () => Error) => {
      if (failure) return;
      failure = error;
      sendSignal("SIGTERM");
      schedule(() => {
        sendSignal("SIGKILL");
        // A grandchild that inherited the pipes can hold them open after the child dies.
        schedule(() => settle(() => reject(error())), CLOSE_WAIT_MS);
      }, killGraceMs);
    };

    const createStream = (name: "stdout" | "stderr") => {
      const decoder = new StringDecoder("utf8");
      let pendingLine = "";
      const append = (text: string) => {
        captured[name] += text;
        captured.output += text;
        pendingLine += text;
        const lines = pendingLine.split("\n");
        pendingLine = lines.pop() ?? "";
        for (const line of lines) logLine(line);
      };
      const logLine = (line: string) => {
        console.log(`[${label} +${formatSeconds(elapsedMs())}s] ${line.replace(/\r$/, "")}`);
      };
      return {
        write(chunk: Buffer) {
          if (failure && capturedBytes > maxCaptureBytes) return;
          capturedBytes += chunk.length;
          if (capturedBytes > maxCaptureBytes) {
            terminate(
              () =>
                new Error(
                  `${label} wrote more than ${maxCaptureBytes} bytes, the e2e capture limit, and was killed.\n${outputTail(captured.output)}`,
                ),
            );
            return;
          }
          append(decoder.write(chunk));
        },
        end() {
          append(decoder.end());
          if (pendingLine) logLine(pendingLine);
          pendingLine = "";
        },
      };
    };

    const stdout = createStream("stdout");
    const stderr = createStream("stderr");
    child.stdout.on("data", (chunk: Buffer) => stdout.write(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.write(chunk));

    child.on("error", (error) => {
      if (child.pid === undefined) {
        settle(() =>
          reject(new Error(`${label} could not be started: ${error.message}`, { cause: error })),
        );
      }
    });
    child.on("exit", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
    });
    child.on("close", () => {
      stdout.end();
      stderr.end();
      if (failure) {
        const error = failure;
        settle(() => reject(error()));
        return;
      }
      const result: CliResult = {
        ok: exitCode === 0,
        exitCode,
        signal: exitSignal,
        ...captured,
        durationMs: elapsedMs(),
      };
      settle(() => {
        reportBudget(label, result, timeoutMs);
        resolve(result);
      });
    });

    schedule(
      () =>
        terminate(
          () => new CliTimeoutError(label, timeoutMs, killSignal ?? "SIGTERM", captured.output),
        ),
      timeoutMs,
    );
  });
}

/**
 * Run a command to completion, rejecting unless it exits with code 0.
 * @param command - Executable to spawn
 * @param args - Arguments for the executable
 * @param options - Working directory, label, budget, and environment
 * @returns Captured output and exit status
 */
export async function runProcess(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<CliResult> {
  const result = await tryProcess(command, args, options);
  if (!result.ok) {
    throw new Error(
      `${options.label} exited with ${describeExit(result)}.\n${outputTail(result.output)}`,
    );
  }
  return result;
}

/**
 * Run the SDK CLI (`bin/tailor.mjs`), resolving for any exit status.
 * @param args - CLI arguments
 * @param options - Working directory, budget, and environment
 * @returns Captured output and exit status
 */
export function tryCli(args: string[], options: CliOptions): Promise<CliResult> {
  return tryProcess(process.execPath, [tailorBin, ...args], cliProcessOptions(args, options));
}

/**
 * Run the SDK CLI (`bin/tailor.mjs`), rejecting unless it exits with code 0.
 * @param args - CLI arguments
 * @param options - Working directory, budget, and environment
 * @returns Captured output and exit status
 */
export function runCli(args: string[], options: CliOptions): Promise<CliResult> {
  return runProcess(process.execPath, [tailorBin, ...args], cliProcessOptions(args, options));
}

function cliProcessOptions(args: string[], options: CliOptions): ProcessOptions {
  const firstFlag = args.findIndex((arg) => arg.startsWith("-"));
  const command = firstFlag === -1 ? args : args.slice(0, firstFlag);
  return {
    ...options,
    label: ["tailor", ...command].join(" "),
    env: {
      NODE_OPTIONS: "--experimental-vm-modules",
      // A configured editor would open generated migration scripts and block the run.
      EDITOR: "",
      VISUAL: "",
      ...options.env,
    },
  };
}

function mergeEnv(overrides: ProcessOptions["env"]): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function reportBudget(label: string, result: CliResult, timeoutMs: number): void {
  const share = result.durationMs / timeoutMs;
  const usage = `${formatSeconds(result.durationMs)}s (${Math.round(share * 100)}% of ${formatSeconds(timeoutMs)}s budget)`;
  console.log(`[${label}] exited ${result.exitCode ?? result.signal} after ${usage}`);
  if (share < BUDGET_WARNING_RATIO) return;
  const message = `${label} took ${usage}`;
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::warning title=E2E CLI budget::${escapeWorkflowCommandData(message)}`);
  } else {
    console.warn(`[${label}] nearing its budget: took ${usage}`);
  }
}

function describeExit(result: CliResult): string {
  return result.exitCode === null ? `signal ${result.signal}` : `code ${result.exitCode}`;
}

function outputTail(output: string): string {
  const tail = output.trimEnd().split("\n").slice(-ERROR_TAIL_LINES).join("\n");
  if (!tail) return "(no output)";
  const bounded = tail.length > ERROR_TAIL_BYTES ? `…${tail.slice(-ERROR_TAIL_BYTES)}` : tail;
  return `Last output:\n${bounded}`;
}

function formatSeconds(ms: number): string {
  return String(Number((ms / 1000).toFixed(1)));
}

function escapeWorkflowCommandData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}
