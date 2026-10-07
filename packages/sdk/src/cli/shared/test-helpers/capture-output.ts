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
 * Captures what is written through `console.log` (one line per call) and
 * `process.stdout.write` for the lifetime of the returned disposable, and
 * restores both spies on dispose. Other console methods such as
 * `console.info` and `console.debug` are not captured: Vitest handles them
 * itself. Use with `using`:
 *
 * ```ts
 * test("...", async () => {
 *   using stdout = captureStdoutStream();
 *   // ...
 *   expect(stdout.output).toBe(`${JSON.stringify(result)}\n`);
 * });
 * ```
 * @returns A `Disposable` exposing the captured stdout via `output`
 */
export function captureStdoutStream(): CapturedOutput {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    chunks.push(encoder.encode(`${args.map(String).join(" ")}\n`));
  });
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? encoder.encode(chunk) : Uint8Array.from(chunk));
      return true;
    });

  return {
    get output() {
      return Buffer.concat(chunks).toString("utf8");
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
