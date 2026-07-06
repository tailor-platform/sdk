import { tailorRoot, withDispose } from "./shared";

type IconvResolver = (method: string, args: unknown[]) => unknown;

interface IconvCall {
  method: string;
  args: unknown[];
}

// ---------------------------------------------------------------------------
// Iconv Mock
// ---------------------------------------------------------------------------

// Iconv methods return `string` for UTF-8 target encodings and `Uint8Array`
// for any other byte-producing encoding (the platform API mirrors this).
function isUtf8(encoding: unknown): boolean {
  return encoding === "UTF8" || encoding === "UTF-8";
}

function defaultIconvResult(method: string, args: unknown[]): unknown {
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
    default:
      return undefined;
  }
}

/**
 * Acquire a disposable mock for `tailor.iconv`. Restored on dispose.
 * @returns Disposable Iconv mock control object
 * @example
 * ```typescript
 * import { mockIconv } from "@tailor-platform/sdk/vitest";
 *
 * test("mock encoding conversion", () => {
 *   using iconv = mockIconv();
 *   iconv.setResolver((method) => (method === "decode" ? "decoded-text" : null));
 *   // …
 * });
 * ```
 */
export function mockIconv() {
  const root = tailorRoot();
  const prev = root.iconv;

  let resolver: IconvResolver | null = null;
  const calls: IconvCall[] = [];

  function handle(method: string, args: unknown[]): unknown {
    calls.push({ method, args: [...args] });
    if (resolver) {
      const result = resolver(method, args);
      if (result != null) return result;
    }
    return defaultIconvResult(method, args);
  }

  class MockIconv {
    #fromEncoding: string;
    #toEncoding: string;
    constructor(fromEncoding: string, toEncoding: string) {
      this.#fromEncoding = fromEncoding;
      this.#toEncoding = toEncoding;
    }
    convert(input: string | Uint8Array | ArrayBuffer): string | Uint8Array {
      return handle("convert", [input, this.#fromEncoding, this.#toEncoding]) as
        | string
        | Uint8Array;
    }
  }

  root.iconv = {
    convert: (str: unknown, from: string, to: string) => handle("convert", [str, from, to]),
    convertBuffer: (buf: unknown, from: string, to: string) =>
      handle("convertBuffer", [buf, from, to]),
    decode: (buf: unknown, encoding: string) => handle("decode", [buf, encoding]),
    encode: (str: string, encoding: string) => handle("encode", [str, encoding]),
    encodings: () => handle("encodings", []),
    Iconv: MockIconv,
  };

  const facade = {
    setResolver(value: IconvResolver): void {
      resolver = value;
    },

    get calls(): IconvCall[] {
      return calls;
    },

    reset(): void {
      resolver = null;
      calls.length = 0;
    },
  };

  return withDispose(facade, () => {
    root.iconv = prev;
  });
}
