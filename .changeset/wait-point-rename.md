---
"@tailor-platform/sdk": major
"@tailor-platform/create-sdk": major
"@tailor-platform/sdk-codemod": patch
---

Rename `defineWaitPoint` and `defineWaitPoints` to `createWaitPoint` and `createWaitPoints`.

These functions create runtime instances with `.wait()` and `.resolve()` methods that call the platform API at runtime, so the `create*` prefix is more accurate. Update any usages:

```diff
-import { defineWaitPoint, defineWaitPoints } from "@tailor-platform/sdk";
+import { createWaitPoint, createWaitPoints } from "@tailor-platform/sdk";

-export const approval = defineWaitPoint<Payload, Result>("approval");
+export const approval = createWaitPoint<Payload, Result>("approval");

-export const waitPoints = defineWaitPoints((define) => ({ ... }));
+export const waitPoints = createWaitPoints((define) => ({ ... }));
```
