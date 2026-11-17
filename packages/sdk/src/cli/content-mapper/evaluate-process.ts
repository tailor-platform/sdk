import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EvaluateConfig, Evaluation } from "./mapper";

export const EVALUATE_FLAG = "--evaluate";

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const EVALUATION_TIMEOUT_MS = 60_000;
const execFileAsync = promisify(execFile);

const KILL_GRACE_MS = 2000;

interface ExecFailure {
  stdout?: string;
}

function reportedBy(failure: ExecFailure): Evaluation | undefined {
  try {
    return JSON.parse(failure.stdout ?? "") as Evaluation;
  } catch {
    return undefined;
  }
}

/**
 * Evaluate the config in a new process each time, so no module cache from an earlier
 * evaluation leaks into the next one.
 * @param entry - The mapper entry script, which evaluates a config when given {@link EVALUATE_FLAG}
 * @param timeoutMs - How long one evaluation may take before its process is stopped
 * @returns A function that evaluates a config in a new process
 */
export function evaluateInFreshProcess(
  entry: string,
  timeoutMs = EVALUATION_TIMEOUT_MS,
): EvaluateConfig {
  return async (configPath) => {
    const running = execFileAsync(process.execPath, [entry, EVALUATE_FLAG, configPath], {
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    const stopped = { byTimeout: false };
    const killTimers: NodeJS.Timeout[] = [];
    // `execFile`'s own `timeout` discards the child's output, which holds the files it loaded.
    killTimers.push(
      setTimeout(() => {
        stopped.byTimeout = true;
        running.child.kill("SIGTERM");
        killTimers.push(setTimeout(() => running.child.kill("SIGKILL"), KILL_GRACE_MS));
      }, timeoutMs),
    );
    try {
      const { stdout } = await running;
      return JSON.parse(stdout) as Evaluation;
    } catch (error) {
      const reported = reportedBy(error as ExecFailure);
      const reason = stopped.byTimeout
        ? `it did not finish within ${timeoutMs / 1000} seconds`
        : (reported?.error ?? (error instanceof Error ? error.message : String(error)));
      return { error: `Evaluating ${configPath} failed: ${reason}`, files: reported?.files ?? [] };
    } finally {
      for (const timer of killTimers) clearTimeout(timer);
    }
  };
}
