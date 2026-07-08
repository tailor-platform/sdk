---
"@tailor-platform/sdk": major
"@tailor-platform/create-sdk": major
"@tailor-platform/sdk-codemod": patch
---

Rename the TailorDB schema builder from `db.type()` to `db.table()`.

Update TailorDB definitions:

```diff
 import { db } from "@tailor-platform/sdk";

-export const user = db.type("User", {
+export const user = db.table("User", {
   name: db.string(),
 });
```
