import { type MockInstance, vi } from "vitest";
import { tailorRoot, withDispose } from "./shared";
import type { TailorIconvAPI } from "#/runtime/iconv";

type IconvResolver = (method: string, args: unknown[]) => unknown;
type IconvMethod = "convert" | "convertBuffer" | "decode" | "encode" | "encodings";

interface IconvCall {
  method: IconvMethod;
  args: unknown[];
}

type ConversionResult = string | Uint8Array;
type ConvertMockProcedure = (
  input: string | Uint8Array | ArrayBuffer,
  fromEncoding: string,
  toEncoding: string,
) => ConversionResult;
type ConvertBufferMockProcedure = (
  input: Uint8Array | ArrayBuffer,
  fromEncoding: string,
  toEncoding: string,
) => ConversionResult;
type EncodeMockProcedure = (input: string, encoding: string) => ConversionResult;
type TypedOperationMock<
  RuntimeProcedure,
  MockProcedure extends (...args: never[]) => unknown,
> = RuntimeProcedure & MockInstance<MockProcedure>;

/** Controls how unconfigured Iconv operations are handled. */
export interface MockIconvOptions {
  /** Return an empty type-compatible value or throw when no behavior is configured. */
  onUnhandled?: "fallback" | "error";
}

// ---------------------------------------------------------------------------
// Iconv Mock
// ---------------------------------------------------------------------------

function isUtf8(encoding: unknown): boolean {
  return encoding === "UTF8" || encoding === "UTF-8";
}

function defaultIconvResult(method: IconvMethod, args: unknown[]): unknown {
  switch (method) {
    case "convert":
    case "convertBuffer":
      return isUtf8(args[2]) ? "" : new Uint8Array();
    case "decode":
      return "";
    case "encode":
      return isUtf8(args[1]) ? "" : new Uint8Array();
    case "encodings":
      return [];
  }
}

/**
 * Acquire a disposable mock for `tailor.iconv`. Restored on dispose.
 * @param options - Fallback behavior for unconfigured operations
 * @returns Disposable Iconv mock control object
 * @example
 * ```typescript
 * import { mockIconv } from "@tailor-platform/sdk/vitest";
 *
 * test("mock encoding conversion", () => {
 *   using iconv = mockIconv();
 *   iconv.decode.mockReturnValue("decoded-text");
 *   // …
 * });
 * ```
 */
export function mockIconv(options: MockIconvOptions = {}) {
  const root = tailorRoot();
  const prev = root.iconv;

  let resolver: IconvResolver | null = null;
  const calls: IconvCall[] = [];

  function resolve(method: IconvMethod, args: unknown[]): unknown {
    if (resolver) {
      const result = resolver(method, args);
      if (result != null) return result;
    }
    if (options.onUnhandled === "error") {
      throw new Error(`No Iconv mock behavior configured for "${method}"`);
    }
    return defaultIconvResult(method, args);
  }

  function defaultConvert<T extends string>(
    input: string | Uint8Array | ArrayBuffer,
    fromEncoding: string,
    toEncoding: T,
  ): T extends "UTF8" | "UTF-8" ? string : Uint8Array {
    return resolve("convert", [input, fromEncoding, toEncoding]) as T extends "UTF8" | "UTF-8"
      ? string
      : Uint8Array;
  }

  function defaultConvertBuffer<T extends string>(
    input: Uint8Array | ArrayBuffer,
    fromEncoding: string,
    toEncoding: T,
  ): T extends "UTF8" | "UTF-8" ? string : Uint8Array {
    return resolve("convertBuffer", [input, fromEncoding, toEncoding]) as T extends "UTF8" | "UTF-8"
      ? string
      : Uint8Array;
  }

  function defaultDecode(input: Uint8Array | ArrayBuffer, encoding: string): string {
    return resolve("decode", [input, encoding]) as string;
  }

  function defaultEncode<T extends string>(
    input: string,
    encoding: T,
  ): T extends "UTF8" | "UTF-8" ? string : Uint8Array {
    return resolve("encode", [input, encoding]) as T extends "UTF8" | "UTF-8" ? string : Uint8Array;
  }

  function defaultEncodings(): string[] {
    return resolve("encodings", []) as string[];
  }

  const convert = vi.fn(defaultConvert) as TypedOperationMock<
    TailorIconvAPI["convert"],
    ConvertMockProcedure
  >;
  const convertBuffer = vi.fn(defaultConvertBuffer) as TypedOperationMock<
    TailorIconvAPI["convertBuffer"],
    ConvertBufferMockProcedure
  >;
  const decode = vi.fn(defaultDecode);
  const encode = vi.fn(defaultEncode) as TypedOperationMock<
    TailorIconvAPI["encode"],
    EncodeMockProcedure
  >;
  const encodings = vi.fn(defaultEncodings);

  function track<Method extends IconvMethod>(
    method: Method,
    operation: TailorIconvAPI[Method],
  ): TailorIconvAPI[Method] {
    return function (this: unknown, ...args: Parameters<TailorIconvAPI[Method]>) {
      calls.push({ method, args: [...args] });
      return (
        operation as (
          ...call: Parameters<TailorIconvAPI[Method]>
        ) => ReturnType<TailorIconvAPI[Method]>
      ).apply(this, args);
    } as TailorIconvAPI[Method];
  }

  const trackedConvert = track("convert", convert);
  const trackedConvertBuffer = track("convertBuffer", convertBuffer);
  const trackedDecode = track("decode", decode);
  const trackedEncode = track("encode", encode);
  const trackedEncodings = track("encodings", encodings);

  class MockIconv {
    #fromEncoding: string;
    #toEncoding: string;

    constructor(fromEncoding: string, toEncoding: string) {
      this.#fromEncoding = fromEncoding;
      this.#toEncoding = toEncoding;
    }

    convert(input: string | Uint8Array | ArrayBuffer): string | Uint8Array {
      return trackedConvert.call(this, input, this.#fromEncoding, this.#toEncoding) as
        | string
        | Uint8Array;
    }
  }

  const iconv: TailorIconvAPI = {
    convert: trackedConvert,
    convertBuffer: trackedConvertBuffer,
    decode: trackedDecode,
    encode: trackedEncode,
    encodings: trackedEncodings,
    Iconv: MockIconv,
  };
  root.iconv = iconv;

  function clear(): void {
    calls.length = 0;
    convert.mockClear();
    convertBuffer.mockClear();
    decode.mockClear();
    encode.mockClear();
    encodings.mockClear();
  }

  const facade = {
    /** The `convert` `vi.fn`. */
    convert,
    /** The `convertBuffer` `vi.fn`. */
    convertBuffer,
    /** The `decode` `vi.fn`. */
    decode,
    /** The `encode` `vi.fn`. */
    encode,
    /** The `encodings` `vi.fn`. */
    encodings,

    setResolver(value: IconvResolver): void {
      resolver = value;
    },

    get calls(): IconvCall[] {
      return calls;
    },

    clear,

    reset(): void {
      resolver = null;
      calls.length = 0;
      convert.mockReset();
      convert.mockImplementation(defaultConvert);
      convertBuffer.mockReset();
      convertBuffer.mockImplementation(defaultConvertBuffer);
      decode.mockReset();
      decode.mockImplementation(defaultDecode);
      encode.mockReset();
      encode.mockImplementation(defaultEncode);
      encodings.mockReset();
      encodings.mockImplementation(defaultEncodings);
    },
  };

  return withDispose(facade, () => {
    root.iconv = prev;
  });
}
