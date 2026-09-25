import { vi } from "vitest";

interface CapturedOutput extends Disposable {
  /** The text accumulated on the captured stream so far. */
  readonly output: string;
}

/**
 * Captures everything written to `console.log` (the channel `logger.out` uses
 * for JSON output) for the lifetime of the returned disposable, restoring the
 * spy on dispose. Use with `using`:
 *
 * ```ts
 * test("...", async () => {
 *   using stdout = captureStdout();
 *   // ...
 *   expect(JSON.parse(stdout.output)).toEqual(...);
 * });
 * ```
 * @returns A `Disposable` exposing the captured stdout via `output`
 */
export function captureStdout(): CapturedOutput {
  let output = "";
  const spy = vi.spyOn(console, "log").mockImplementation((chunk) => {
    output += String(chunk);
  });

  return {
    get output() {
      return output;
    },
    [Symbol.dispose]() {
      spy.mockRestore();
    },
  };
}

/**
 * Captures everything written to `process.stderr` for the lifetime of the
 * returned disposable, restoring the spy on dispose. Use with `using`:
 *
 * ```ts
 * test("...", async () => {
 *   using stderr = captureStderr();
 *   // ...
 *   expect(stderr.output).toBe("");
 * });
 * ```
 * @returns A `Disposable` exposing the captured stderr via `output`
 */
export function captureStderr(): CapturedOutput {
  let output = "";
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });

  return {
    get output() {
      return output;
    },
    [Symbol.dispose]() {
      spy.mockRestore();
    },
  };
}
