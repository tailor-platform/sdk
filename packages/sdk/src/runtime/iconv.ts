/**
 * Character encoding conversion utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.iconv` runtime API.
 * At runtime this delegates to `globalThis.tailor.iconv`, which is provided by
 * the Tailor Platform Function runtime. Use `mockIconv` from
 * `@tailor-platform/sdk/vitest` to mock these calls in unit tests.
 * @example
 * import { iconv } from "@tailor-platform/sdk/runtime";
 *
 * const utf8 = iconv.convert(sjisBuffer, "Shift_JIS", "UTF-8"); // string
 * const sjis = iconv.convert("こんにちは", "UTF-8", "Shift_JIS"); // Uint8Array
 *
 * const conv = new iconv.Iconv("Shift_JIS", "UTF-8");
 * const out = conv.convert(sjisBuffer);
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Instance methods exposed by `tailor.iconv.Iconv`. */
export interface IconvInstance {
  convert(input: string | Uint8Array | ArrayBuffer): string | Uint8Array;
}

/** Constructor shape for `tailor.iconv.Iconv`. */
export interface IconvConstructor {
  new (fromEncoding: string, toEncoding: string): IconvInstance;
}

/**
 * Platform API surface for `tailor.iconv`. Describes the shape the platform
 * runtime injects on `globalThis.tailor.iconv` so the wrapper and ambient
 * globals stay in sync.
 *
 * Each method below is also re-exported as a top-level named export from this
 * module (e.g. `convert`, `decode`, `encode`) so callers can either
 * `import * as iconv from "@tailor-platform/sdk/runtime/iconv"` or pick
 * individual methods.
 */
export interface TailorIconvAPI {
  /**
   * Convert a string or buffer between encodings.
   * @param str - Input data to convert
   * @param fromEncoding - Source encoding name
   * @param toEncoding - Target encoding name
   * @returns `string` when `toEncoding` is `"UTF8"` or `"UTF-8"`, otherwise `Uint8Array`.
   */
  convert<T extends string>(
    str: string | Uint8Array | ArrayBuffer,
    fromEncoding: string,
    toEncoding: T,
  ): T extends "UTF8" | "UTF-8" ? string : Uint8Array;

  /**
   * Convert a buffer between encodings.
   * @param buffer - Input bytes to convert
   * @param fromEncoding - Source encoding name
   * @param toEncoding - Target encoding name
   * @returns `string` when `toEncoding` is `"UTF8"` or `"UTF-8"`, otherwise `Uint8Array`.
   */
  convertBuffer<T extends string>(
    buffer: Uint8Array | ArrayBuffer,
    fromEncoding: string,
    toEncoding: T,
  ): T extends "UTF8" | "UTF-8" ? string : Uint8Array;

  /**
   * Decode a buffer to a UTF-8 string using the given source encoding.
   * @param buffer - Input bytes
   * @param encoding - Source encoding name
   * @returns Decoded UTF-8 string
   */
  decode(buffer: Uint8Array | ArrayBuffer, encoding: string): string;

  /**
   * Encode a UTF-8 string into the given target encoding.
   * @param str - Input string
   * @param encoding - Target encoding name
   * @returns `string` when `encoding` is `"UTF8"` or `"UTF-8"`, otherwise `Uint8Array`.
   */
  encode<T extends string>(
    str: string,
    encoding: T,
  ): T extends "UTF8" | "UTF-8" ? string : Uint8Array;

  /**
   * Returns the list of supported encoding names.
   * @returns Array of encoding names supported by the platform iconv runtime
   */
  encodings(): string[];

  /** Constructor for the stateful {@link Iconv} converter. */
  Iconv: IconvConstructor;
}

const api = (): TailorIconvAPI =>
  (globalThis as { tailor: { iconv: TailorIconvAPI } }).tailor.iconv;

/**
 * See {@link TailorIconvAPI.convert}.
 * @param args - Forwarded to {@link TailorIconvAPI.convert}
 * @returns `string` when `toEncoding` is `"UTF8"` or `"UTF-8"`, otherwise `Uint8Array`.
 */
export const convert: TailorIconvAPI["convert"] = (...args) => api().convert(...args);

/**
 * See {@link TailorIconvAPI.convertBuffer}.
 * @param args - Forwarded to {@link TailorIconvAPI.convertBuffer}
 * @returns `string` when `toEncoding` is `"UTF8"` or `"UTF-8"`, otherwise `Uint8Array`.
 */
export const convertBuffer: TailorIconvAPI["convertBuffer"] = (...args) =>
  api().convertBuffer(...args);

/**
 * See {@link TailorIconvAPI.decode}.
 * @param args - Forwarded to {@link TailorIconvAPI.decode}
 * @returns Decoded UTF-8 string
 */
export const decode: TailorIconvAPI["decode"] = (...args) => api().decode(...args);

/**
 * See {@link TailorIconvAPI.encode}.
 * @param args - Forwarded to {@link TailorIconvAPI.encode}
 * @returns `string` when `encoding` is `"UTF8"` or `"UTF-8"`, otherwise `Uint8Array`.
 */
export const encode: TailorIconvAPI["encode"] = (...args) => api().encode(...args);

/**
 * See {@link TailorIconvAPI.encodings}.
 * @returns Array of encoding names supported by the platform iconv runtime
 */
export const encodings: TailorIconvAPI["encodings"] = () => api().encodings();

/**
 * Stateful converter for repeated conversions between a fixed encoding pair.
 * Compatible with the `node-iconv` API surface.
 */
export class Iconv {
  private impl: IconvInstance;

  constructor(fromEncoding: string, toEncoding: string) {
    this.impl = new (api().Iconv)(fromEncoding, toEncoding);
  }

  /**
   * Convert input using this converter's fixed encoding pair.
   * @param input - Bytes or string to convert
   * @returns Encoded output (string for UTF-8 targets, otherwise `Uint8Array`).
   */
  convert(input: string | Uint8Array | ArrayBuffer): string | Uint8Array {
    return this.impl.convert(input);
  }
}
