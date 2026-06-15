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

Importing from `@tailor-platform/sdk` does not activate the ambient `tailor.*` / `tailordb.*` declarations. If you want to opt into the globals, add a single side-effect import anywhere in your project:

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

The globals entry exposes the lowercase `tailordb.*` namespace only. Use `pnpm dlx @tailor-platform/sdk-codemod v2/tailordb-namespace` before upgrading if your project still references the removed capital-cased `Tailordb.*` namespace from `@tailor-platform/function-types`.

## Namespaces

The runtime entry re-exports the following namespaces. Detailed signatures, parameters, and return types live in the JSDoc next to each export — hover the symbol in your IDE or browse the source.

- `iconv` — character encoding conversion (`convert`, `convertBuffer`, `decode`, `encode`, `encodings`, `Iconv`)
- `secretmanager` — secret-vault access (`getSecret`, `getSecrets`)
- `authconnection` — OAuth-style connection tokens (`getConnectionToken`)
- `idp` — IdP user management (`new Client({ namespace })`)
- `workflow` — workflow & job control (`triggerWorkflow`, `triggerJobFunction`, `wait`, `resolve`)
- `context` — execution context (`getInvoker`)
- `file` — `tailordb.file` BLOB API (`upload`, `download`, `downloadAsBase64`, `delete`, `getMetadata`, `downloadStream`, `uploadStream`, `openDownloadStream` _(deprecated)_)

## Testing

`@tailor-platform/sdk/vitest` ships mock controllers for every runtime namespace. Pair them with the `tailor-runtime` Vitest environment so your unit tests run against the same wrappers your production code does. Each controller is a factory — acquire it with a `using` declaration and its state is reset automatically when the test scope exits (no `beforeEach(() => mock.reset())` needed). Requires TypeScript ≥ 5.2 and a runtime with `Symbol.dispose` (Node ≥ 20.4; the SDK targets Node ≥ 22).

```ts
import { iconv, secretmanager } from "@tailor-platform/sdk/runtime";
import { mockIconv, mockSecretmanager } from "@tailor-platform/sdk/vitest";
import { expect, test } from "vitest";

test("encodes via iconv", () => {
  using iconvM = mockIconv();
  iconvM.setResolver(() => new Uint8Array([0x82, 0xa0]));

  const out = iconv.convert("あ", "UTF-8", "Shift_JIS");

  expect(out).toEqual(new Uint8Array([0x82, 0xa0]));
  expect(iconvM.calls[0]?.method).toBe("convert");
}); // iconvM disposed here — the iconv mock is removed (previous state restored)

test("reads from a vault", async () => {
  using sm = mockSecretmanager();
  sm.setSecrets({ "my-vault": { API_KEY: "sk-123" } });

  await expect(secretmanager.getSecret("my-vault", "API_KEY")).resolves.toBe("sk-123");
});
```

See [Testing Guide](./testing.md#runtime-environment-emulation-beta) for the full list of mock controllers and the `tailor-runtime` environment setup.
