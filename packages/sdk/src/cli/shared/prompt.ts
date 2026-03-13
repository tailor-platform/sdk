import * as clack from "@clack/prompts";
import { isCI } from "std-env";
import { CIPromptError } from "./logger";
import type { ConfirmOptions, TextOptions } from "@clack/prompts";

/**
 * Wraps a `@clack/prompts` function with CI guard and cancellation handling.
 * @param fn - A prompt function that returns `T | symbol`
 * @returns A wrapped function that throws in CI and exits on cancel
 */
function withGuard<Opts, T>(fn: (opts: Opts) => Promise<T | symbol>) {
  return async (opts: Opts): Promise<T> => {
    if (isCI) throw new CIPromptError();
    const result = await fn(opts);
    if (clack.isCancel(result)) process.exit(0);
    return result;
  };
}

export const confirm = withGuard<ConfirmOptions, boolean>(clack.confirm);
export const text = withGuard<TextOptions, string>(clack.text);
