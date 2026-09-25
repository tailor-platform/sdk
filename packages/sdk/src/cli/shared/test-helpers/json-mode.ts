import { logger } from "#/cli/shared/logger";

/**
 * Enables `logger.jsonMode` for the lifetime of the returned disposable and
 * restores the previous value on dispose. Use with `using`:
 *
 * ```ts
 * test("...", async () => {
 *   using _json = jsonMode();
 *   // ...
 * });
 * ```
 * @param enabled - Whether to enable JSON mode (defaults to `true`)
 * @returns A `Disposable` that restores the previous `logger.jsonMode`
 */
export function jsonMode(enabled = true): Disposable {
  const original = logger.jsonMode;
  logger.jsonMode = enabled;
  return {
    [Symbol.dispose]() {
      logger.jsonMode = original;
    },
  };
}
