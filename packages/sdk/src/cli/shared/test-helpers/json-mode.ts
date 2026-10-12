import { jsonDefaultAgent, logger, setJsonDefaultAgent } from "#/cli/shared/logger";

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

/**
 * Records `agent` as the AI coding agent running the CLI for the lifetime of
 * the returned disposable, as the Tailor CLI does when it detects one, and
 * restores the previous record on dispose. Use with `using`.
 * @param agent - Agent id, such as `"claude_code"`
 * @returns A `Disposable` that restores the previously recorded agent
 */
export function detectedAgent(agent: string): Disposable {
  const original = jsonDefaultAgent();
  setJsonDefaultAgent(agent);
  return {
    [Symbol.dispose]() {
      setJsonDefaultAgent(original);
    },
  };
}
