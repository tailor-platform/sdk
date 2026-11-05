---
description: "Call resolvers and TailorDB records from the frontend as typed functions, with arguments and results typed from your definitions and no GraphQL to write."
---

# Frontend Client

Import `resolvers.tailor` and `tailordb.tailor` in your frontend to call your resolvers and TailorDB tables as typed functions. The SDK builds the GraphQL request and types the arguments and the result from your `createResolver` and table definitions, so you restate neither.

```ts
import { greet } from "./resolvers.tailor";
import { Task } from "./tailordb.tailor";

const result = await greet({ name: "Ada" });
result.message; // string

const page = await Task.list({ query: { status: { eq: "TODO" } }, first: 10 });
page.nodes; // Task[]
```

## Setup

Typing these imports needs TypeScript 7.1 or later.

1. Create two empty files, `resolvers.tailor` and `tailordb.tailor`, anywhere in your frontend, such as `src/`. Their content is ignored, and the file names are fixed.

2. Add the SDK as a content mapper for `.tailor` files in `tsconfig.json`, and type-check with `--runExternalCode`:

   ```jsonc
   {
     "contentMappers": [{ "package": "@tailor-platform/sdk", "extensions": [".tailor"] }],
   }
   ```

   `--runExternalCode` lets TypeScript run your `tailor.config.ts` and the files it imports each time it checks the project; without it TypeScript reports error TS18068. Enable it only for projects whose code you trust.

   `resolvers.tailor` and `tailordb.tailor` are typed from the `tailor.config.ts` nearest to the file, so a frontend inside the backend's project needs nothing more. A frontend that is a separate package has no config above its `tsconfig.json`, and TypeScript reports an error for the SDK's own types. Give the backend's config in `options.config`, relative to the `tsconfig.json`; the SDK then uses it for every file:

   ```jsonc
   {
     "contentMappers": [
       {
         "package": "@tailor-platform/sdk",
         "extensions": [".tailor"],
         "options": { "config": "../backend/tailor.config.ts" },
       },
     ],
   }
   ```

3. Add the Vite plugin, so that the imports run as well as type-check. It reads the same `tailor.config.ts`:

   ```ts
   // vite.config.ts
   import { tailorResolvers } from "@tailor-platform/sdk/cli";

   export default {
     plugins: [
       tailorResolvers({ url: "https://xyz.erp.dev", config: "../backend/tailor.config.ts" }),
     ],
   };
   ```

   Both options are optional: `url` is the application's URL, used when the app does not call `configureResolvers`, and `config` defaults to the nearest `tailor.config.ts` above the imported file. A relative `config` path is resolved from the directory Vite runs in.

## Calling resolvers

Each resolver is exported from `resolvers.tailor` under its `name`, as a function of its input. The result has the type of its `output`.

```ts
import { greet } from "./resolvers.tailor";

await greet({ name: "Ada", title: "Dr." }); // { message: string; length: number }
await greet({}); // type error: 'name' is missing
```

Dates are strings, enums are string unions, and nested objects and arrays keep their shape. Changing a resolver's `input`, `output`, or `name` in the backend shows up as type errors in the calls that no longer fit.

A resolver name must be a valid GraphQL name, which excludes hyphens.

## Calling TailorDB

`tailordb.tailor` exports one object per table, under the table's name. The record type comes from the table definition.

| Call                     | Result                                   |
| ------------------------ | ---------------------------------------- |
| `Task.get(id, options?)` | The record, or `null` when there is none |
| `Task.list(options?)`    | `{ nodes, pageInfo, total }`             |
| `Task.create(input)`     | The created record                       |
| `Task.update(id, input)` | The updated record                       |
| `Task.delete(id)`        | `true` when it was deleted               |

`create` takes the required fields; `id`, `createdAt`, and `updatedAt` can be left out. `update` takes any of the fields except `id`.

### Filtering and ordering

`list` takes `query`, `order`, `first`, `after`, `last`, and `before`. The operators `query` accepts follow the kind of the field, and an operator the platform does not accept for it is a type error. Combine conditions with `and`, `or`, and `not`.

| Field                                         | Operators                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| uuid, enum                                    | `eq`, `ne`, `in`, `nin`                                                                                               |
| boolean                                       | `eq`, `ne`                                                                                                            |
| string                                        | `eq`, `ne`, `in`, `nin`, `contains`, `notContains`, `hasPrefix`, `hasSuffix`, `notHasPrefix`, `notHasSuffix`, `regex` |
| integer, float, decimal, date, datetime, time | `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `between` (`{ min, max }`)                                         |
| array                                         | `len` (compares the length), `has` and `all` (filter the elements), `exists`                                          |
| nested object                                 | The filters of the fields inside it, and `exists`                                                                     |

```ts
await Task.list({
  query: {
    or: [{ priority: { gte: 5 } }, { title: { hasPrefix: "Write" } }],
    dueOn: { between: { min: "2026-01-01", max: "2026-02-28" } },
  },
  order: [{ field: "title", direction: "Asc" }],
});
```

### Choosing fields with `select`

`get` and `list` take `select` to fetch only some fields. The result type has only those fields. Without it, every field is fetched.

```ts
const task = await Task.get(id, { select: { id: true, title: true } });
task?.title; // string
task?.done; // type error: not selected
```

### Relations with `include`

`include` adds the table's relations to the result: a record for a many-to-one relation, and an array for a one-to-many one. A relation can take its own `select`, and a one-to-many relation can also take `query`, `order`, `first`, `after`, `last`, and `before`.

```ts
const customer = await Customer.get(id, {
  select: { name: true },
  include: {
    orders: {
      select: { amount: true },
      first: 10,
      order: [{ field: "amount", direction: "Desc" }],
    },
  },
});
customer?.orders[0]?.amount; // number

const orders = await Order.list({ include: { customer: { select: { name: true } } } });
orders.nodes[0]?.customer.name; // string
```

`include` goes one level deep. You cannot filter by the fields of a relation, and tables that a plugin generates are not exported.

## Authentication

Call `configureResolvers` once at startup. Every call after that is sent through the `fetch` you give it.

```ts
import { configureResolvers } from "@tailor-platform/sdk/client";

configureResolvers({
  url: "https://xyz.erp.dev",
  fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
});
```

An auth client with `getAppUri()` and an authenticated `fetch`, such as the one AppShell's `createAuthClient` returns, can be passed as is:

```ts
configureResolvers(authClient);
```

## Errors

A failed call throws a `ResolverError`, exported from `@tailor-platform/sdk/client`, with the HTTP `status`, the `code` and `attr` the application reported, and every error in `errors`.

```ts
import { ResolverError } from "@tailor-platform/sdk/client";

try {
  await greet({ name: "Ada" });
} catch (error) {
  if (error instanceof ResolverError) console.error(error.status, error.code, error.attr);
}
```
