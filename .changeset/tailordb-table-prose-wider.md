---
"@tailor-platform/sdk": patch
---

`deploy`, schema loading, and the config parser now call a `db.table()` definition a table instead of a type, matching the vocabulary the docs and `db.table()` already use. The deploy plan lists a `TailorDB tables` section and names a deleted table as `TailorDB table "Order"`, a table missing `.permission()` is reported as `TailorDB table "User" has no .permission() configured`, and relation errors read `Field "userID" on table "Employee"`.

Messages about a field's data type, and the TypeScript types generated into `db.ts`, are unchanged.
