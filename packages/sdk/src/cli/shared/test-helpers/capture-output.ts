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
 * Captures everything that reaches stdout for the lifetime of the returned
 * disposable: `console.log` (one line per call) and `process.stdout.write`.
 * Restores both spies on dispose. Use with `using`:
 *
 * ```ts
 * test("...", async () => {
 *   using stdout = captureStdoutStream();
 *   // ...
 *   expect(stdout.output.trim().split("\n")).toHaveLength(1);
 * });
 * ```
 * @returns A `Disposable` exposing everything written to stdout via `output`
 */
export function captureStdoutStream(): CapturedOutput {
  let output = "";
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    output += `${args.map(String).join(" ")}\n`;
  });
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });

  return {
    get output() {
      return output;
    },
    [Symbol.dispose]() {
      log.mockRestore();
      write.mockRestore();
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
