# SafeQL Plugin

Type-check the raw SQL you write against your TailorDB tables, and get the type of each result row inferred, with [SafeQL](https://safeql.dev/).

## The `sql` tag

`sql` turns a template literal into a parameterized statement. Interpolated values become query parameters (`$1`, `$2`, ...); they are never spliced into the statement text.

```ts
import { sql } from "@tailor-platform/sdk-plugin-safeql";

const rows = await sql<{ email: string }>`
  SELECT "email" FROM "Account" WHERE "age" >= ${minimumAge}
`.execute(client);
```

`execute` accepts anything with a `queryObject(text, values)` method, such as a `tailordb.Client`, and resolves to the returned rows.
