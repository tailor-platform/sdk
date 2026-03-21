import { ExitPromptError } from "@inquirer/core";
import { confirm, input, password } from "@inquirer/prompts";
import { isCI } from "std-env";
import { CIPromptError } from "./logger";

/**
 * Wraps a prompt function with CI guard and cancellation handling.
 * @param fn - A prompt function from `@inquirer/prompts`
 * @returns A wrapped function that throws in CI and exits on cancel
 */
function withGuard<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  return async (...args: Args): Promise<R> => {
    if (isCI) throw new CIPromptError();
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ExitPromptError) process.exit(130);
      throw error;
    }
  };
}

export const prompt = {
  confirm: withGuard(confirm),
  text: withGuard(input),
  password: withGuard(password),
};
