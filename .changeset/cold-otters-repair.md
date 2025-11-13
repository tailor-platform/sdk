---
"@tailor-platform/tailor-sdk": minor
---

Changed the interface for `apply` / `generate`

**Breaking Changes:**

When calling `apply` / `generate` as functions, specifying `configPath` as the first argument was mandatory, but We've made it optional to align with other commands.

before:

```ts
import { apply } from "@tailor-platform/tailor-sdk/cli";

// default
await apply("tailor.config.ts");
// custom path
await apply("./path/to/tailor.config.ts");
```

after:

```ts
import { apply } from "@tailor-platform/tailor-sdk/cli";

// default
await apply();
// custom path
await apply({ configPath: "./path/to/tailor.config.ts" });
```
