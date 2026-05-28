import { vi } from "vitest";
import { logger } from "@/cli/shared/logger";

type LoggerMethod = {
  [K in keyof typeof logger]: (typeof logger)[K] extends (...args: never[]) => unknown ? K : never;
}[keyof typeof logger];

/**
 * Silences the given logger methods for the lifetime of the returned
 * disposable. Use with `using` so spies are restored when the enclosing
 * block exits:
 *
 * ```ts
 * test("...", () => {
 *   using _logger = silenceLogger("out", "success", "warn");
 *   // ...
 * });
 * ```
 * @param methods - Logger method names to silence
 * @returns A `Disposable` that restores all silenced methods when disposed
 */
export function silenceLogger(...methods: LoggerMethod[]): Disposable {
  const stack = new DisposableStack();
  for (const method of methods) {
    stack.use(vi.spyOn(logger, method).mockImplementation((() => {}) as never));
  }
  return stack;
}
