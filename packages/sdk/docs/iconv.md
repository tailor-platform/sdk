# Character Encoding Conversion (iconv)

`@tailor-platform/sdk/iconv` is a thin typed wrapper around the platform-provided `tailor.iconv` runtime API. It enables conversion between character encodings — useful for handling Shift_JIS / EUC-JP CSV imports, integrating with mainframes that use IBM EBCDIC variants, or normalizing legacy data into UTF-8.

For the full list of supported encodings and platform-side details, see the official [Character Encoding Conversion](https://docs.tailor.tech/reference/concepts/character-encodings.html) reference.

## Overview

The module provides:

- Stateless functions for one-off conversions: `convert`, `convertBuffer`, `decode`, `encode`, `encodings`
- A stateful `Iconv` class for repeated conversions between a fixed encoding pair (compatible with the `node-iconv` API surface)
- A typed test mock helper, `setupIconvMock`, for unit tests

All functions and the `Iconv` class delegate to `globalThis.tailor.iconv` at runtime, which is provided by the Tailor Platform Function runtime. They are intended for use inside resolvers, executors, and workflow jobs.

## Supported Encodings

Common encodings include:

- **Unicode**: `UTF-8`, `UTF-16`, `UTF-16BE`, `UTF-16LE`
- **Japanese**: `Shift_JIS` (aliases: `SJIS`, `CP932`), `EUC-JP`, `EUC-JP-MS`, `ISO-2022-JP`
- **Enterprise / mainframe**: IBM EBCDIC variants (`IBM037`, `IBM290`, `IBM930`, `IBM939`, `IBM943`), Hitachi KEIS, NEC JIS aliases
- **Chinese**: `GB2312`, `GBK`, `GB18030`, `Big5`, `BIG5HKSCS`
- **Korean**: `EUC-KR`, `UHC`, `JOHAB`, `ISO-2022-KR`
- **Other**: `ISO-8859-1`, `ASCII`

Call `encodings()` at runtime to get the full list supported by the platform.

## API

### `convert(data, fromEncoding, toEncoding)`

Convert a string or buffer between encodings. The return type narrows based on `toEncoding`: it is `string` when `toEncoding` is `"UTF-8"` or `"UTF8"`, and `Uint8Array` otherwise.

```typescript
import { convert } from "@tailor-platform/sdk/iconv";

// UTF-8 string → Shift_JIS bytes
const sjisBytes = convert("日本語テキスト", "UTF-8", "Shift_JIS");
//    ^? Uint8Array

// EUC-JP bytes → UTF-8 string
const utf8Text = convert(eucjpBuffer, "EUC-JP", "UTF-8");
//    ^? string
```

### `convertBuffer(buffer, fromEncoding, toEncoding)`

Like `convert`, but accepts only a `Uint8Array | ArrayBuffer` input. Use this when you want the type system to enforce buffer input.

### `decode(buffer, encoding)`

Decode a buffer into a UTF-8 string by interpreting it with the given source encoding. Equivalent to `convert(buffer, encoding, "UTF-8")`.

```typescript
import { decode } from "@tailor-platform/sdk/iconv";

const text = decode(sjisCsvBuffer, "Shift_JIS"); // string
```

### `encode(str, encoding)`

Encode a UTF-8 string into the given target encoding. Returns `string` when the target is UTF-8, otherwise `Uint8Array`.

```typescript
import { encode } from "@tailor-platform/sdk/iconv";

const sjisBytes = encode("こんにちは", "Shift_JIS"); // Uint8Array
```

### `encodings()`

Return the list of supported encoding identifiers from the runtime.

```typescript
import { encodings } from "@tailor-platform/sdk/iconv";

const list = encodings(); // string[]
```

### `Iconv` class

Stateful converter for repeated conversions between a fixed encoding pair. Useful when you process many records with the same source/target encoding and want to avoid passing the encoding pair on every call.

```typescript
import { Iconv } from "@tailor-platform/sdk/iconv";

const conv = new Iconv("Shift_JIS", "UTF-8");
for (const row of sjisRows) {
  const utf8 = conv.convert(row); // string | Uint8Array
}
```

## Error Handling Flags

Append flags to `toEncoding` to control behavior on unconvertible characters:

| Flag              | Behavior                                                                          |
| ----------------- | --------------------------------------------------------------------------------- |
| `//IGNORE`        | Silently skip characters that cannot be represented in the target encoding        |
| `//TRANSLIT`      | Replace unconvertible characters with `?` (default substitute)                    |
| `//TRANSLIT:char` | Replace unconvertible characters with the specified replacement (e.g. `*`, `[?]`) |

```typescript
import { convert } from "@tailor-platform/sdk/iconv";

convert("Hello 世界!", "UTF-8", "ASCII//TRANSLIT:*");
// → "Hello **!"

convert("Test 日本語", "UTF-8", "ASCII//TRANSLIT:[?]");
// → "Test [?][?][?]"
```

## Usage in a Resolver

A common pattern is to fetch bytes from a TailorDB file field, decode them, and process the result. Bytes can come from `tailordb.file.download` (or a generated helper from the [`file-utils` plugin](./plugin/index.md)), an external HTTP fetch, or a base64-encoded input.

```typescript
import { createResolver, t } from "@tailor-platform/sdk";
import { decode } from "@tailor-platform/sdk/iconv";

export default createResolver({
  name: "importSjisCsv",
  operation: "mutation",
  input: { csvBase64: t.string() },
  output: { rows: t.int() },
  body: async ({ input }) => {
    const bytes = Uint8Array.from(atob(input.csvBase64), (c) => c.charCodeAt(0));
    const text = decode(bytes, "Shift_JIS");
    const rows = text.split("\n").filter((line) => line.length > 0).length;
    // ...persist parsed rows
    return { rows };
  },
});
```

## Testing

Use `setupIconvMock()` from `@tailor-platform/sdk/test` to mock `tailor.iconv` in unit tests. The default implementation passes strings through and uses Node's `TextEncoder`/`TextDecoder` for UTF-8, which is enough for most assertions. For non-UTF-8 round trips, supply your own handler via `onConvert`.

```typescript
import { afterEach, describe, expect, test } from "vitest";
import { setupIconvMock, unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import resolver from "./resolvers/importSjisCsv";

const TailorGlobal = globalThis as { tailor?: { iconv?: unknown } };

describe("importSjisCsv resolver", () => {
  afterEach(() => {
    delete TailorGlobal.tailor;
  });

  test("decodes Shift_JIS CSV", async () => {
    const { calls } = setupIconvMock({
      onDecode: (_buffer, encoding) => {
        expect(encoding).toBe("Shift_JIS");
        return "name,age\nAlice,30\n";
      },
    });

    const result = await resolver.body({
      input: { csvBase64: btoa("dummy bytes") },
      user: unauthenticatedTailorUser,
      env: {},
    });

    expect(result).toEqual({ rows: 2 });
    expect(calls).toHaveLength(1);
  });
});
```

`setupIconvMock` records every call in the returned `calls` array (`{ method, args }`) so you can assert that the right encoding was requested. Clean up by deleting `TailorGlobal.tailor` in `afterEach`.
