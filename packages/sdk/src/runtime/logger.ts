/**
 * Structured logging utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.logger` runtime API.
 * At runtime this delegates to `globalThis.tailor.logger`. Use `mockLogger`
 * from `@tailor-platform/sdk/vitest` to mock these calls in unit tests.
 *
 * Unlike `console.*`, each call carries a severity and structured attributes.
 * The message is written to standard output, and the full entry with its
 * attributes is exported over OpenTelemetry, where the attributes are queryable.
 * @example
 * import { logger } from "@tailor-platform/sdk/runtime";
 *
 * logger.setAttributes({ requestId: "r-123" });
 * logger.info("order processed", { orderId: "o-1", total: 99.5 });
 */

/**
 * A single log attribute value. Values outside this union (`null`, nested
 * objects, mixed-type arrays) are silently dropped by the platform.
 */
export type LogAttributeValue =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[]
  | readonly boolean[];

/**
 * Structured attributes attached to a log entry. The platform keeps at most 32
 * entries, drops any entry whose key exceeds 128 bytes, and truncates string
 * values over 4096 bytes and arrays over 64 elements.
 */
export type LogAttributes = Record<string, LogAttributeValue>;

/**
 * Platform API surface for `tailor.logger`. Describes the shape the platform
 * runtime injects on `globalThis.tailor.logger`.
 *
 * Each method below is also re-exported as a top-level named export from this
 * module so callers can either `import * as logger from
 * "@tailor-platform/sdk/runtime/logger"` or pick individual methods.
 */
export interface TailorLoggerAPI {
  /**
   * Emits a `debug`-severity log entry.
   * @param message - The log message
   * @param attributes - Structured attributes to attach to this entry
   */
  debug(message: string, attributes?: LogAttributes): void;

  /**
   * Emits an `info`-severity log entry.
   * @param message - The log message
   * @param attributes - Structured attributes to attach to this entry
   */
  info(message: string, attributes?: LogAttributes): void;

  /**
   * Emits a `warn`-severity log entry.
   * @param message - The log message
   * @param attributes - Structured attributes to attach to this entry
   */
  warn(message: string, attributes?: LogAttributes): void;

  /**
   * Emits an `error`-severity log entry.
   * @param message - The log message
   * @param attributes - Structured attributes to attach to this entry
   */
  error(message: string, attributes?: LogAttributes): void;

  /**
   * Merges attributes into every subsequent log entry from the current
   * execution. Later keys overwrite earlier ones; per-call attributes passed to
   * `debug`/`info`/`warn`/`error` take precedence.
   * @param attributes - Attributes to attach to subsequent entries
   */
  setAttributes(attributes: LogAttributes): void;
}

// Each wrapper below inlines the `(globalThis as {...}).tailor.logger` cast
// (rather than sharing a helper) so bundle-log-level.ts's manualPureFunctions
// can statically match the callee and tree-shake calls below the build's logLevel.

/**
 * See {@link TailorLoggerAPI.debug}.
 * @param args - Forwarded to {@link TailorLoggerAPI.debug}
 */
export const debug: TailorLoggerAPI["debug"] = (...args) => {
  (globalThis as { tailor: { logger: TailorLoggerAPI } }).tailor.logger.debug(...args);
};

/**
 * See {@link TailorLoggerAPI.info}.
 * @param args - Forwarded to {@link TailorLoggerAPI.info}
 */
export const info: TailorLoggerAPI["info"] = (...args) => {
  (globalThis as { tailor: { logger: TailorLoggerAPI } }).tailor.logger.info(...args);
};

/**
 * See {@link TailorLoggerAPI.warn}.
 * @param args - Forwarded to {@link TailorLoggerAPI.warn}
 */
export const warn: TailorLoggerAPI["warn"] = (...args) => {
  (globalThis as { tailor: { logger: TailorLoggerAPI } }).tailor.logger.warn(...args);
};

/**
 * See {@link TailorLoggerAPI.error}.
 * @param args - Forwarded to {@link TailorLoggerAPI.error}
 */
export const error: TailorLoggerAPI["error"] = (...args) => {
  (globalThis as { tailor: { logger: TailorLoggerAPI } }).tailor.logger.error(...args);
};

/**
 * See {@link TailorLoggerAPI.setAttributes}.
 * @param args - Forwarded to {@link TailorLoggerAPI.setAttributes}
 */
export const setAttributes: TailorLoggerAPI["setAttributes"] = (...args) => {
  (globalThis as { tailor: { logger: TailorLoggerAPI } }).tailor.logger.setAttributes(...args);
};
