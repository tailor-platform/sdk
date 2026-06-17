import { vi } from "vitest";
import { logger } from "#src/cli/shared/logger";

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
  // Avoid `DisposableStack` — not in Node 22 (V8 12.4), which the SDK supports
  // (`engines.node: >=22`). `Symbol.dispose` is available since Node 20.4.
  const spies = methods.map((method) =>
    vi.spyOn(logger, method).mockImplementation((() => {}) as never),
  );
  return {
    [Symbol.dispose]() {
      for (const spy of spies) spy.mockRestore();
    },
  };
}
