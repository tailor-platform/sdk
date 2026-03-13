import * as clack from "@clack/prompts";
import { isCI } from "std-env";
import { CIPromptError } from "./logger";
/**
 * Wraps `@clack/prompts` functions with CI guard and cancellation handling.
 * @param fns
 * @returns Guarded prompt functions that throw in CI and exit on cancel
 */
function guardedPrompts<T extends Record<string, (opts: never) => Promise<unknown>>>(
  fns: T,
): {
  [K in keyof T]: T[K] extends (opts: infer O) => Promise<(infer R) | symbol>
    ? (opts: O) => Promise<R>
    : T[K];
} {
  return Object.fromEntries(
    Object.entries(fns).map(([key, fn]) => [
      key,
      async (opts: never) => {
        if (isCI) throw new CIPromptError();
        const result = await fn(opts);
        if (clack.isCancel(result)) process.exit(0);
        return result;
      },
    ]),
  ) as ReturnType<typeof guardedPrompts<T>>;
}

export const prompt = guardedPrompts({
  confirm: clack.confirm,
  text: clack.text,
});
