import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EvaluateConfig, Evaluation } from "./mapper";

export const EVALUATE_FLAG = "--evaluate";

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const execFileAsync = promisify(execFile);

/**
 * Evaluate the config in a new process each time, so no module cache from an earlier
 * evaluation leaks into the next one.
 * @param entry - The mapper entry script, which evaluates a config when given {@link EVALUATE_FLAG}
 * @returns A function that evaluates a config in a new process
 */
export function evaluateInFreshProcess(entry: string): EvaluateConfig {
  return async (configPath) => {
    try {
      const { stdout } = await execFileAsync(process.execPath, [entry, EVALUATE_FLAG, configPath], {
        maxBuffer: MAX_OUTPUT_BYTES,
      });
      return JSON.parse(stdout) as Evaluation;
    } catch (error) {
      return {
        error: `Evaluating ${configPath} failed: ${error instanceof Error ? error.message : String(error)}`,
        files: [],
      };
    }
  };
}
