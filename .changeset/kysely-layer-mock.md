---
"@tailor-platform/sdk": minor
---

Add `createKyselyMock` to `@tailor-platform/sdk/vitest` for unit-testing code that runs Kysely queries. It returns a real Kysely instance whose execution is mocked. You stage the rows each query returns, run your code, then assert what it did — the SQL and parameters of each query, how many `selects`/`inserts`/`updates`/`deletes` ran, and the value your code returned.

```ts
import { createKyselyMock } from "@tailor-platform/sdk/vitest";
import type { Namespace } from "./generated/db";

const mock = createKyselyMock<Namespace["main-db"]>();
mock.enqueueResults([{ age: 30 }]); // the next query returns this row

const { age } = await mock.db
  .selectFrom("User")
  .select("age")
  .where("email", "=", "a@b.com")
  .executeTakeFirstOrThrow();
await mock.db
  .updateTable("User")
  .set({ age: age + 1 })
  .where("email", "=", "a@b.com")
  .execute();

expect(mock.updates).toHaveLength(1);
expect(mock.updates[0].parameters).toEqual([31, "a@b.com"]); // the actual bound values
expect(mock.updates[0].sql).toContain('update "User"'); // the compiled SQL
```
