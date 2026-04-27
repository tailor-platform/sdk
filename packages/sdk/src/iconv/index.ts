/// <reference types="@tailor-platform/function-types" />

/**
 * Character encoding conversion utilities.
 *
 * Thin typed wrapper around the platform-provided `tailor.iconv` runtime API.
 * At runtime this delegates to `globalThis.tailor.iconv`, which is provided by
 * the Tailor Platform Function runtime. Use `setupIconvMock()` from
 * `@tailor-platform/sdk/test` to mock these calls in unit tests.
 * @example
 * import { convert, decode, encode, Iconv } from "@tailor-platform/sdk/iconv";
 *
 * const utf8 = convert(sjisBuffer, "Shift_JIS", "UTF-8"); // string
 * const sjis = convert("こんにちは", "UTF-8", "Shift_JIS"); // Uint8Array
 *
 * const iconv = new Iconv("Shift_JIS", "UTF-8");
 * const out = iconv.convert(sjisBuffer);
 */

/**
 * Convert a string or buffer between encodings.
 * Returns `string` when `toEncoding` is `"UTF8"` or `"UTF-8"`, otherwise `Uint8Array`.
 * @param str - Input data
 * @param fromEncoding - Source encoding
 * @param toEncoding - Target encoding
 * @returns Converted string or buffer
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
 * Returns `string` when `toEncoding` is `"UTF8"` or `"UTF-8"`, otherwise `Uint8Array`.
 * @param buffer - Input buffer
 * @param fromEncoding - Source encoding
 * @param toEncoding - Target encoding
 * @returns Converted string or buffer
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
 * @param buffer - Input buffer
 * @param encoding - Source encoding of the buffer
 * @returns Decoded string
 */
export function decode(buffer: Uint8Array | ArrayBuffer, encoding: string): string {
  return tailor.iconv.decode(buffer, encoding);
}

/**
 * Encode a UTF-8 string into the given target encoding.
 * Returns `string` when `encoding` is `"UTF8"` or `"UTF-8"`, otherwise `Uint8Array`.
 * @param str - Input string (UTF-8)
 * @param encoding - Target encoding
 * @returns Encoded buffer or string
 */
export function encode<T extends string>(
  str: string,
  encoding: T,
): T extends "UTF8" | "UTF-8" ? string : Uint8Array {
  return tailor.iconv.encode(str, encoding);
}

/**
 * Returns the list of supported encoding names.
 * @returns Array of supported encoding identifiers
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

  /**
   * @param fromEncoding - Source encoding
   * @param toEncoding - Target encoding
   */
  constructor(fromEncoding: string, toEncoding: string) {
    this.impl = new tailor.iconv.Iconv(fromEncoding, toEncoding);
  }

  /**
   * Convert input using this converter's fixed encoding pair.
   * @param input - Input data
   * @returns Converted string or buffer
   */
  convert(input: string | Uint8Array | ArrayBuffer): string | Uint8Array {
    return this.impl.convert(input);
  }
}
