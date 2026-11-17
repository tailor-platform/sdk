import { isCLIError, type CLIError } from "#/cli/shared/errors";

export interface HookFailures {
  /** Keep a failure a hook found for `run`. */
  record(error: CLIError): void;
  /**
   * Run the body of a rolldown hook, keeping a CLIError it throws for `run`.
   * @param hook - Hook body
   * @param fallback - What the hook returns in place of the failed result
   * @returns Result of `hook`, or `fallback` when it threw a CLIError
   */
  capture<T, F>(hook: () => T, fallback: F): T | F;
  /**
   * Run the build, throwing the first failure kept during it whether the build resolves or rejects.
   * @param build - Starts the rolldown build
   * @returns Result of `build`
   */
  run<T>(build: () => Promise<T>): Promise<T>;
}

/**
 * Keep the CLIError a rolldown hook throws until the build is over: rolldown
 * rejects with an error of its own, which loses the code.
 * @returns Wrapper for hook bodies and for the build
 */
export function createHookFailures(): HookFailures {
  let first: CLIError | undefined;
  const record = (error: CLIError): void => {
    first ??= error;
  };
  return {
    record,
    capture(hook, fallback) {
      try {
        return hook();
      } catch (error) {
        if (!isCLIError(error)) throw error;
        record(error);
        return fallback;
      }
    },
    async run(build) {
      const result = await build().catch((error: unknown) => {
        throw first ?? error;
      });
      if (first) throw first;
      return result;
    },
  };
}
