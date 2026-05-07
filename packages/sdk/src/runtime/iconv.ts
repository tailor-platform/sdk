/**
 * Character encoding conversion utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.iconv` runtime API.
 * At runtime this delegates to `globalThis.tailor.iconv`, which is provided by
 * the Tailor Platform Function runtime. Use `iconvMock` from
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

import "./globals";

/**
 * Convert a string or buffer between encodings.
 * @param str - Input data to convert
 * @param fromEncoding - Source encoding name
 * @param toEncoding - Target encoding name
 * @returns `string` when `toEncoding` is `"UTF8"` or `"UTF-8"`, otherwise `Uint8Array`.
 */
export function convert<T extends string>(
  str: string | Uint8Array | ArrayBuffer,
  fromEncoding: string,
  toEncoding: T,
): T extends "UTF8" | "UTF-8" ? string : Uint8Array {
  return tailor.iconv.convert(str, fromEncoding, toEncoding);
}

/**
 * Convert a buffer between encodings.
 * @param buffer - Input bytes to convert
 * @param fromEncoding - Source encoding name
 * @param toEncoding - Target encoding name
 * @returns `string` when `toEncoding` is `"UTF8"` or `"UTF-8"`, otherwise `Uint8Array`.
 */
export function convertBuffer<T extends string>(
  buffer: Uint8Array | ArrayBuffer,
  fromEncoding: string,
  toEncoding: T,
): T extends "UTF8" | "UTF-8" ? string : Uint8Array {
  return tailor.iconv.convertBuffer(buffer, fromEncoding, toEncoding);
}

/**
 * Decode a buffer to a UTF-8 string using the given source encoding.
 * @param buffer - Input bytes
 * @param encoding - Source encoding name
 * @returns Decoded UTF-8 string
 */
export function decode(buffer: Uint8Array | ArrayBuffer, encoding: string): string {
  return tailor.iconv.decode(buffer, encoding);
}

/**
 * Encode a UTF-8 string into the given target encoding.
 * @param str - Input string
 * @param encoding - Target encoding name
 * @returns `string` when `encoding` is `"UTF8"` or `"UTF-8"`, otherwise `Uint8Array`.
 */
export function encode<T extends string>(
  str: string,
  encoding: T,
): T extends "UTF8" | "UTF-8" ? string : Uint8Array {
  return tailor.iconv.encode(str, encoding);
}

/**
 * Returns the list of supported encoding names.
 * @returns Array of encoding names supported by the platform iconv runtime
 */
export function encodings(): string[] {
  return tailor.iconv.encodings();
}

interface IconvImpl {
  convert(input: string | Uint8Array | ArrayBuffer): string | Uint8Array;
}

/**
 * Stateful converter for repeated conversions between a fixed encoding pair.
 * Compatible with the `node-iconv` API surface.
 */
export class Iconv {
  private impl: IconvImpl;

  constructor(fromEncoding: string, toEncoding: string) {
    this.impl = new tailor.iconv.Iconv(fromEncoding, toEncoding);
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
