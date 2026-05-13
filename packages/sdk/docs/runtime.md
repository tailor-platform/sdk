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

> Type-only re-exports follow the platform contract. If a future runtime release adds new fields, the SDK will publish them in lockstep — there is no separate `@tailor-platform/function-types` package to upgrade.

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

## API Reference

### `iconv`

Character encoding conversion. The return type narrows to `string` for `"UTF8"` / `"UTF-8"` targets and `Uint8Array` otherwise.

| Function        | Description                                                |
| --------------- | ---------------------------------------------------------- |
| `convert`       | Convert a string or buffer between encodings               |
| `convertBuffer` | Convert bytes between encodings                            |
| `decode`        | Decode bytes to a UTF-8 string                             |
| `encode`        | Encode a UTF-8 string into the given target encoding       |
| `encodings`     | List supported encoding names                              |
| `Iconv` (class) | Stateful converter for repeated conversions (`node-iconv`) |

### `secretmanager`

| Function     | Returns                                       |
| ------------ | --------------------------------------------- |
| `getSecret`  | `Promise<string \| undefined>`                |
| `getSecrets` | `Promise<Partial<Record<T[number], string>>>` |

Pass the `names` argument as a `const` tuple to narrow the result keys: `getSecrets("v", ["A", "B"] as const)`.

### `authconnection`

| Function             | Returns                 |
| -------------------- | ----------------------- |
| `getConnectionToken` | Provider-specific token |

### `idp`

`new idp.Client({ namespace })` exposes the IdP user APIs:

- `users(options?)`, `user(userId)`, `userByName(name)`
- `createUser(input)`, `updateUser(input)`, `deleteUser(userId)`
- `sendPasswordResetEmail({ userId, redirectUri })`

### `workflow`

| Function             | Description                                    |
| -------------------- | ---------------------------------------------- |
| `triggerWorkflow`    | Trigger a workflow and return its execution ID |
| `triggerJobFunction` | Trigger a job and return its result            |
| `wait`               | Suspend a job at a wait point                  |
| `resolve`            | Resolve a wait point on a running execution    |

### `context`

| Function     | Returns                                |
| ------------ | -------------------------------------- |
| `getInvoker` | `Invoker \| null` (anonymous = `null`) |

### `file`

`tailordb.file` BLOB API. Internally implemented as `deleteFile` to avoid the reserved keyword; exported as `delete`.

| Function             | Description                                        |
| -------------------- | -------------------------------------------------- |
| `upload`             | Upload bytes for a record's file field             |
| `download`           | Download a file (≤ 10 MB)                          |
| `downloadAsBase64`   | Download a file as a Base64 string (≤ 10 MB)       |
| `delete`             | Delete a file                                      |
| `getMetadata`        | Fetch file metadata only                           |
| `openDownloadStream` | Open an async iterator for files larger than 10 MB |

For files larger than 10 MB, `download` and `downloadAsBase64` throw `TailorDBFileError` with code `FILE_TOO_LARGE`; switch to `openDownloadStream` for those.

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
