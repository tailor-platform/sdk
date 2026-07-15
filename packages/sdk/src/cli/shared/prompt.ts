import { ExitPromptError } from "@inquirer/core";
import { confirm, input, password, select } from "@inquirer/prompts";
import { isCI } from "std-env";
import { CIPromptError, logger } from "./logger";

export function canPrompt(): boolean {
  return !isCI && process.stdin.isTTY === true && process.stdout.isTTY === true && !logger.jsonMode;
}

/**
 * Wraps a prompt function with CI guard and cancellation handling.
 * @param fn - A prompt function from `@inquirer/prompts`
 * @param unavailableMessage - Message used when interactive input is unavailable
 * @returns A wrapped function that throws in CI and exits on cancel
 */
function withGuard<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
  unavailableMessage?: string,
): (...args: Args) => Promise<R> {
  return async (...args: Args): Promise<R> => {
    if (!canPrompt()) throw new CIPromptError(unavailableMessage);
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ExitPromptError) process.exit(130);
      throw error;
    }
  };
}

export const prompt = {
  confirm: withGuard(
    confirm,
    "Interactive confirmations are not available in this environment. Use --yes to skip confirmation prompts, or provide the required options explicitly.",
  ),
  text: withGuard(input),
  password: withGuard(password),
  select: withGuard(select),
};
