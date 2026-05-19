---
"@tailor-platform/sdk": minor
---

Add `@tailor-platform/sdk/runtime` — typed wrappers for the Tailor Platform Function runtime APIs (`tailor.iconv`, `tailor.secretmanager`, `tailor.authconnection`, `tailor.idp`, `tailor.workflow`, `tailor.context`, and `tailordb.file`). The wrappers and their types are fully self-contained, so you can use them without activating any ambient globals.

```ts
import { iconv, secretmanager, idp, file } from "@tailor-platform/sdk/runtime";

const utf8 = iconv.convert(sjisBuffer, "Shift_JIS", "UTF-8");
const apiKey = await secretmanager.getSecret("my-vault", "API_KEY");
const client = new idp.Client({ namespace: "my-namespace" });
const { metadata } = await file.upload("ns", "Document", "attachment", recordId, bytes);
```

The SDK no longer depends on the external `@tailor-platform/function-types` package; its declarations are now vendored inside the SDK. For backwards compatibility the ambient `tailor.*` / `tailordb.*` types are still activated automatically when you import from `@tailor-platform/sdk`, so existing code keeps type-checking with no changes. This implicit activation will be removed in v2.0 — new code is encouraged to use the typed wrappers from `@tailor-platform/sdk/runtime`, or to opt into the globals explicitly via `import "@tailor-platform/sdk/runtime/globals"` (or by listing the entry in `tsconfig.json`'s `compilerOptions.types`).

The capital-cased `Tailordb` ambient namespace (`Tailordb.QueryResult`, `Tailordb.CommandType`, `Tailordb.Client`) is preserved as a `@deprecated` alias of the new lowercase `tailordb.*` namespace for source-level compatibility with `@tailor-platform/function-types`. It will be removed in v2.0; run `pnpm dlx @tailor-platform/sdk-codemod v2/tailordb-namespace` to migrate. The `@tailor-platform/function-types` declarations are vendored inside the SDK and activated automatically, so you can simply remove `@tailor-platform/function-types` from your `package.json` (and from `tsconfig.json` `compilerOptions.types` if listed) once you've upgraded.

Other test-mock changes from `@tailor-platform/sdk/vitest`:

- Breaking: when an `openDownloadStream` (or `toFileStream()`) call consumes a queued mock result, raw `Uint8Array` / `ArrayBuffer` payloads are now rejected. Enqueue a structured iterable of `StreamValue` items (`{ type: "metadata" }`, `{ type: "chunk", data, position }`, `{ type: "complete" }`) so test streams stay aligned with the platform's structured stream contract. The shorthand `Uint8Array` enqueue is still accepted by `download` / `downloadAsBase64`.
