import { vi } from "vitest";
import { tailorRoot, withDispose } from "./shared";
import type { LogAttributes } from "#/runtime/logger";

type LogSeverity = "debug" | "info" | "warn" | "error";

/** A recorded `debug`/`info`/`warn`/`error` call. */
interface LogCall {
  severity: LogSeverity;
  message: string;
  attributes?: LogAttributes;
}

/** Initial fixtures for a logger mock. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface MockLoggerOptions {}

// ---------------------------------------------------------------------------
// Logger Mock
// ---------------------------------------------------------------------------

/**
 * Acquire a disposable mock for `tailor.logger`. Each method is a `vi.fn`, so
 * calls can be asserted directly; `calls` returns the `debug`/`info`/`warn`/
 * `error` entries in the order they were emitted. Restored on dispose.
 * @param _options - Reserved for future initial fixtures
 * @returns Disposable logger mock control object
 * @example
 * ```typescript
 * import { mockLogger } from "@tailor-platform/sdk/vitest";
 *
 * test("logs the processed order", () => {
 *   using logger = mockLogger();
 *   // …run code that calls tailor.logger.info…
 *   expect(logger.info).toHaveBeenCalledWith("order processed", { orderId: "o-1" });
 * });
 * ```
 */
export function mockLogger(_options: MockLoggerOptions = {}) {
  const root = tailorRoot();
  const prev = root.logger;

  const debug = vi.fn((_message: string, _attributes?: LogAttributes): void => {});
  const info = vi.fn((_message: string, _attributes?: LogAttributes): void => {});
  const warn = vi.fn((_message: string, _attributes?: LogAttributes): void => {});
  const error = vi.fn((_message: string, _attributes?: LogAttributes): void => {});
  const setAttributes = vi.fn((_attributes: LogAttributes): void => {});

  root.logger = { debug, info, warn, error, setAttributes };

  const severityFns: Record<LogSeverity, typeof debug> = { debug, info, warn, error };

  const facade = {
    /** The `debug` `vi.fn`. */
    debug,
    /** The `info` `vi.fn`. */
    info,
    /** The `warn` `vi.fn`. */
    warn,
    /** The `error` `vi.fn`. */
    error,
    /** The `setAttributes` `vi.fn`. */
    setAttributes,

    get calls(): LogCall[] {
      // Merge all severities back into chronological order via vi.fn's global
      // invocationCallOrder, so a test mixing severities sees them in the order
      // they actually ran (not grouped by method).
      const entries = (Object.entries(severityFns) as [LogSeverity, typeof debug][]).flatMap(
        ([severity, fn]) =>
          fn.mock.calls.map((args, i) => ({
            order: fn.mock.invocationCallOrder[i] ?? 0,
            call: { severity, message: args[0], attributes: args[1] },
          })),
      );
      return entries.toSorted((a, b) => a.order - b.order).map((e) => e.call);
    },

    clear(): void {
      debug.mockClear();
      info.mockClear();
      warn.mockClear();
      error.mockClear();
      setAttributes.mockClear();
    },

    reset(): void {
      debug.mockReset();
      info.mockReset();
      warn.mockReset();
      error.mockReset();
      setAttributes.mockReset();
    },
  };

  return withDispose(facade, () => {
    root.logger = prev;
  });
}
