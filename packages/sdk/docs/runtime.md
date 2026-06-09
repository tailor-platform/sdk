# Runtime API

`@tailor-platform/sdk/runtime` provides typed wrappers for the `tailor.*` and `tailordb.file` APIs that the Tailor Platform Function runtime injects into the global scope at execution time. The wrappers are thin and delegate to the platform-provided globals; they exist so that you can:

- Reach the runtime API without relying on a separate ambient `.d.ts` package
- Get IDE-friendly imports (`iconv.convert`, `idp.Client`, …) instead of unmemorable `tailor.iconv.convert(...)` calls
- Use the same module surface in resolvers, executors, and workflows

The wrappers and their associated types are self-contained — you do not need to activate any ambient globals to use them. If you also want `tailor.iconv.convert(...)` calls to type-check, opt into the globals via the [Activating the global types](#activating-the-global-types) section below.

## Quick Start

```ts
import {
  iconv,
  secretmanager,
  authconnection,
  idp,
  workflow,
  context,
  file,
} from "@tailor-platform/sdk/runtime";

const utf8 = iconv.convert(sjisBuffer, "Shift_JIS", "UTF-8");

const apiKey = await secretmanager.getSecret("my-vault", "API_KEY");

const token = await authconnection.getConnectionToken("google");

const client = new idp.Client({ namespace: "my-namespace" });
const { users } = await client.users({ first: 10 });

const executionId = await workflow.triggerWorkflow("approval", { reportId });

const invoker = context.getInvoker();

const { metadata } = await file.upload("my-namespace", "Document", "attachment", recordId, bytes);
```

## Subpath imports

Each namespace can also be imported individually so you only pull what you need:

```ts
import * as iconv from "@tailor-platform/sdk/runtime/iconv";
import type { ListUsersResponse, ClientConfig } from "@tailor-platform/sdk/runtime/idp";
```

## Activating the global types

Most users do not need to touch the globals entry — `@tailor-platform/sdk/runtime` (and its subpath modules) cover the same surface without depending on any ambient declaration.

For backwards compatibility with the previous `@tailor-platform/function-types`-based setup, the SDK still activates the ambient `tailor.*` / `tailordb.*` types automatically when you import from `@tailor-platform/sdk`. **This implicit activation will be removed in v2.0**; new code should prefer the typed wrappers from `@tailor-platform/sdk/runtime`.

If you want to opt into the globals explicitly (or you are migrating ahead of v2.0), add a single side-effect import anywhere in your project:

```ts
import "@tailor-platform/sdk/runtime/globals";
```

Or register the entry in `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "types": ["@tailor-platform/sdk/runtime/globals"],
  },
}
```

## WebAssembly (`.wasm`)

The function runtime exposes the standard `WebAssembly` API, but the sandbox **cannot fetch `.wasm` files at runtime** — the path emscripten-style glue uses by default fails with `RuntimeError: Aborted(both async and sync fetching of the wasm failed)`. Instead, import the `.wasm` module statically. The SDK bundler inlines it into your function as a `Uint8Array`, the same model single-bundle runtimes (Cloudflare Workers, Vercel Edge, Deno) use:

```ts
import wasmBytes from "./add.wasm"; // inlined as a Uint8Array at build time

const { instance } = await WebAssembly.instantiate(wasmBytes, {});
const add = instance.exports.add as (a: number, b: number) => number;
add(2, 3); // 5
```

### Using emscripten-generated libraries

Most prebuilt wasm libraries ship emscripten glue that fetches a separate `.wasm` file at runtime — which fails in the sandbox. Two ways to make them work:

1. **`instantiateWasm` hook (no rebuild).** Import the `.wasm` bytes and hand them to the glue's `Module.instantiateWasm` hook so it instantiates from memory instead of fetching:

   ```ts
   import { wasm } from "@tailor-platform/sdk/runtime";
   import wasmBytes from "./module.wasm";
   import createModule from "./module.js"; // emscripten glue

   const mod = await createModule({
     instantiateWasm: wasm.instantiateWasmFromBytes(wasmBytes),
   });
   ```

2. **Build the library as a single file.** If you control the build, emscripten's `-sSINGLE_FILE` flag embeds the wasm as base64 inside the glue JS, removing the runtime fetch entirely.

### Constraints

- **Runtime fetch is not supported.** `fetch("./mod.wasm")` / `WebAssembly.instantiateStreaming(fetch(...))` against a separate file does not work; the `.wasm` must be reachable through a static `import` so the bundler can inline it.
- **Size & memory.** Inlining adds ~33% to the encoded module size, and it counts against the function memory limit (Function 32 MB / Job Function 256 MB). Large rasterizers/codecs may not fit a 32 MB function.
- **No threads / WASI.** Modules that require `SharedArrayBuffer` + Workers, WASI, or host filesystem access are not supported by the sandbox.

### Type support

At build time the bundler resolves a `.wasm` import to a `Uint8Array`, but TypeScript needs an ambient declaration to type the import (the same one-liner Vite/webpack projects add for `*.svg`/`*.css`). Add it once anywhere in your project, e.g. in a `wasm.d.ts`:

```ts
declare module "*.wasm" {
  // `Uint8Array<ArrayBuffer>` (not bare `Uint8Array`) so the bytes satisfy
  // `BufferSource` on TypeScript >= 5.7, where typed arrays became generic.
  const bytes: Uint8Array<ArrayBuffer>;
  export default bytes;
}
```

## Namespaces

The runtime entry re-exports the following namespaces. Detailed signatures, parameters, and return types live in the JSDoc next to each export — hover the symbol in your IDE or browse the source.

- `iconv` — character encoding conversion (`convert`, `convertBuffer`, `decode`, `encode`, `encodings`, `Iconv`)
- `secretmanager` — secret-vault access (`getSecret`, `getSecrets`)
- `authconnection` — OAuth-style connection tokens (`getConnectionToken`)
- `idp` — IdP user management (`new Client({ namespace })`)
- `workflow` — workflow & job control (`triggerWorkflow`, `triggerJobFunction`, `wait`, `resolve`)
- `context` — execution context (`getInvoker`)
- `file` — `tailordb.file` BLOB API (`upload`, `download`, `downloadAsBase64`, `delete`, `getMetadata`, `downloadStream`, `uploadStream`, `openDownloadStream` _(deprecated)_)
- `wasm` — WebAssembly helpers (`instantiateWasmFromBytes`)

## Testing

`@tailor-platform/sdk/vitest` ships mock controllers for every runtime namespace. Pair them with the `tailor-runtime` Vitest environment so your unit tests run against the same wrappers your production code does.

```ts
import { iconv, secretmanager } from "@tailor-platform/sdk/runtime";
import { iconvMock, secretmanagerMock } from "@tailor-platform/sdk/vitest";
import { beforeEach, expect, test } from "vitest";

beforeEach(() => {
  iconvMock.reset();
  secretmanagerMock.reset();
});

test("encodes via iconv", () => {
  iconvMock.setResolver(() => new Uint8Array([0x82, 0xa0]));

  const out = iconv.convert("あ", "UTF-8", "Shift_JIS");

  expect(out).toEqual(new Uint8Array([0x82, 0xa0]));
  expect(iconvMock.calls[0]?.method).toBe("convert");
});

test("reads from a vault", async () => {
  secretmanagerMock.setSecrets({ "my-vault": { API_KEY: "sk-123" } });

  await expect(secretmanager.getSecret("my-vault", "API_KEY")).resolves.toBe("sk-123");
});
```

See [Testing Guide](./testing.md#runtime-environment-emulation-beta) for the full list of mock controllers and the `tailor-runtime` environment setup.
