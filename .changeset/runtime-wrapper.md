---
"@tailor-platform/sdk": minor
---

Add `@tailor-platform/sdk/runtime` — typed wrappers for the Tailor Platform Function runtime APIs (`tailor.iconv`, `tailor.secretmanager`, `tailor.authconnection`, `tailor.idp`, `tailor.workflow`, `tailor.context`, and `tailordb.file`). Importing the entry also activates the corresponding ambient `tailor.*` / `tailordb` global types, so existing code that calls `tailor.iconv.convert(...)` directly continues to type-check.

```ts
import { iconv, secretmanager, idp, file } from "@tailor-platform/sdk/runtime";

const utf8 = iconv.convert(sjisBuffer, "Shift_JIS", "UTF-8");
const apiKey = await secretmanager.getSecret("my-vault", "API_KEY");
const client = new idp.Client({ namespace: "my-namespace" });
const { metadata } = await file.upload("ns", "Document", "attachment", recordId, bytes);
```

The SDK no longer depends on the external `@tailor-platform/function-types` package; its declarations are now vendored inside the SDK and exported as `@tailor-platform/sdk/runtime/globals` for projects that prefer to pin global types via `tsconfig.json`'s `compilerOptions.types`. Most users do not need to import `/runtime/globals` directly — `@tailor-platform/sdk/runtime` activates the ambient types as a side effect.
