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

The SDK no longer depends on the external `@tailor-platform/function-types` package; its declarations are now vendored inside the SDK. If you still want unqualified `tailor.iconv.convert(...)` / `new tailordb.Client(...)` calls to type-check, opt into the globals by adding a side-effect `import "@tailor-platform/sdk/runtime/globals"` or by listing it in `tsconfig.json`'s `compilerOptions.types`.
