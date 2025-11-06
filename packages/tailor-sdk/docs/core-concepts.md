# Conceptual Guides

### TailorDB Concepts

Define TailorDB Types in files matching glob patterns specified in `tailor.config.ts`.

#### Field Types

Define TailorDB Fields using methods like `db.string()`, `db.int()`, etc. All TailorDB Field types are supported:

| Method          | TailorDB | TypeScript |
| --------------- | -------- | ---------- |
| `db.string()`   | String   | string     |
| `db.int()`      | Integer  | number     |
| `db.float()`    | Float    | number     |
| `db.bool()`     | Boolean  | boolean    |
| `db.date()`     | Date     | string     |
| `db.datetime()` | DateTime | string     |
| `db.time()`     | Time     | string     |
| `db.uuid()`     | UUID     | string     |
| `db.enum()`     | Enum     | string     |
| `db.object()`   | Nested   | object     |

**Enum fields** - specify allowed values as arguments:

```typescript
db.enum("red", "green", "blue");
db.enum(
  { value: "active", description: "Active status" },
  { value: "inactive", description: "Inactive status" },
);
```

**Object fields** - specify field structure as an argument:

```typescript
db.object({
  street: db.string(),
  city: db.string(),
  country: db.string(),
});
```

#### Optional and Array Fields

Make fields optional or arrays by specifying options:

```typescript
db.string({ optional: true });
db.string({ array: true });
db.string({ optional: true, array: true });
```

The `assertNonNull` option creates a field that doesn't allow null in TypeScript types but does allow null in TailorDB. This is useful for fields like createdAt where non-null values are set through hooks:

```typescript
db.string({ optional: true, assertNonNull: true }).hooks({
  create: () => "created value",
  update: () => "updated value",
});
```

#### Field Modifiers

**Description** - Add a description to field:

```typescript
db.string().description("User's full name");
```

**Index / Unique** - Add an index to field:

```typescript
db.string().index();
db.string().unique();
```

**Relations** - Add a relation to field with automatic index and foreign key constraint:

```typescript
const role = db.type("Role", {
  name: db.string(),
});

const user = db.type("User", {
  name: db.string(),
  roleId: db.uuid().relation({
    type: "n-1",
    toward: { type: role },
  }),
});
```

For one-to-one relations, use `type: "1-1"`:

```typescript
const userProfile = db.type("UserProfile", {
  userId: db.uuid().relation({
    type: "1-1",
    toward: { type: user },
  }),
  bio: db.string(),
});
```

For foreign key constraint without creating a relation, use `type: "keyOnly"`:

```typescript
const user = db.type("User", {
  roleId: db.uuid().relation({
    type: "keyOnly",
    toward: { type: role },
  }),
});
```

Create relations against different fields using `toward.key`:

```typescript
const user = db.type("User", {
  email: db.string().unique(),
});

const userProfile = db.type("UserProfile", {
  userEmail: db.string().relation({
    type: "1-1",
    toward: { type: user, key: "email" },
  }),
});
```

Customize relation names using `toward.as` / `backward` options:

```typescript
const userProfile = db.type("UserProfile", {
  userId: db.uuid().relation({
    type: "1-1",
    toward: { type: user, as: "base" },
    backward: "profile",
  }),
});
```

**Hooks** - Add hooks to execute functions during data creation or update:

```typescript
db.datetime().hooks({
  create: ({ value }) => new Date().toISOString(),
  update: ({ value }) => new Date().toISOString(),
});
```

Function arguments include: `value` (field value), `data` (entire record value), `user` (user performing the operation).

**Validation** - Add validation functions to field:

```typescript
db.string().validate(
  ({ value }) => value.length > 5,
  [
    ({ value }) => value.length < 10,
    "Value must be shorter than 10 characters",
  ],
);
```

**Vector Search** - Enable field for vector search:

```typescript
db.string().vector();
```

**Serial / Auto-increment** - Enable field auto-increment:

```typescript
db.int().serial({
  start: 0,
  maxValue: 100,
});

db.string().serial({
  start: 0,
  format: "CUST_%d",
});
```

**Common Fields** - Add common fields using built-in helpers:

```typescript
export const user = db.type("User", {
  name: db.string(),
  ...db.fields.timestamps(),
});
```

#### Type Definition

Define a TailorDB Type using `db.type()` method:

```typescript
db.type("User", {
  name: db.string(),
});
```

Specify PluralForm by passing an array as first argument:

```typescript
db.type(["User", "UserList"], {
  name: db.string(),
});
```

Pass a description as second argument:

```typescript
db.type("User", "User in the system", {
  name: db.string(),
  description: db.string().optional(),
});
```

**Composite Indexes** - Configure composite indexes:

```typescript
db.type("User", {
  firstName: db.string(),
  lastName: db.string(),
}).indexes({
  fields: ["firstName", "lastName"],
  unique: true,
  name: "user_name_idx",
});
```

**File Fields** - Add file fields:

```typescript
db.type("User", {
  name: db.string(),
}).files({
  avatar: "profile image",
});
```

**Features** - Enable additional features:

```typescript
db.type("User", {
  name: db.string(),
}).features({
  aggregation: true,
  bulkUpsert: true,
});
```

**Permissions** - Configure Permission and GQLPermission. For details, see the [TailorDB Permission documentation](https://docs.tailor.tech/guides/tailordb/permission).

```typescript
db.type("User", {
  name: db.string(),
  role: db.enum("admin", "user").index(),
})
  .permission({
    create: [[{ user: "role" }, "=", "admin"]],
    read: [
      [{ user: "role" }, "=", "admin"],
      [{ record: "id" }, "=", { user: "id" }],
    ],
    update: [[{ user: "role" }, "=", "admin"]],
    delete: [[{ user: "role" }, "=", "admin"]],
  })
  .gqlPermission([
    { conditions: [[{ user: "role" }, "=", "admin"]], actions: "all" },
    { conditions: [[{ user: "role" }, "=", "user"]], actions: ["read"] },
  ]);
```

Following the secure-by-default principle, all operations are denied if permissions are not configured.

### Resolver Concepts

Define Resolvers in files matching glob patterns specified in `tailor.config.ts`.

#### Resolver Creation

Define Resolvers using `createResolver` method:

```typescript
createResolver({
  name: "add",
  operation: "query",
  input: t.type({
    left: t.int(),
    right: t.int(),
  }),
  body: (context) => {
    return {
      result: context.input.left + context.input.right,
    };
  },
  output: t.type({
    result: t.int(),
  }),
});
```

#### Input/Output Schemas

Define Input/Output schemas using methods of `t` object. Basic usage and supported field types are the same as TailorDB. TailorDB-specific options (e.g., index, relation) are not supported.

You can reuse fields defined with `db` object, but note that unsupported options will be ignored:

```typescript
const user = db.type("User", {
  name: db.string().unique(),
  age: db.int(),
});

createResolver({
  input: t.type({
    name: user.fields.name,
  }),
});
```

#### Body Function

Define actual resolver logic in the `body` function. Function arguments include: `input` (input data), `user` (user performing the operation).

If you're generating Kysely types with a generator, you can use `getDB` to execute typed queries:

```typescript
import { getDB } from "../generated/tailordb";

createResolver({
  name: "getUser",
  operation: "query",
  input: t.type({
    name: t.string(),
  }),
  body: async (context) => {
    const db = getDB("tailordb");
    const query = db
      .selectFrom("User")
      .select("id")
      .where("name", "=", context.input.name)
      .limit(1)
      .executeTakeFirstOrThrow();
    return {
      result: result.id,
    };
  },
  output: t.type({
    result: t.uuid(),
  }),
});
```

### Executor Patterns

Define Executors in files matching glob patterns specified in `tailor.config.ts`.

```typescript
createExecutor({
  name: "user-welcome",
  description: "Send welcome email to new users",
  trigger: recordCreatedTrigger({
    type: user,
    condition: ({ newRecord }) => !!newRecord.email && newRecord.isActive,
  }),
  operation: {
    kind: "function",
    body: async ({ newRecord }) => {
      // Send welcome email logic here
    },
  },
});
```

#### Trigger Types

**Record Triggers** - Fire when records are created, updated, or deleted:

- `recordCreatedTrigger()`: Fires when a new record is created
- `recordUpdatedTrigger()`: Fires when a record is updated
- `recordDeletedTrigger()`: Fires when a record is deleted

Each trigger can include an optional filter function:

```typescript
recordUpdatedTrigger({
  type: order,
  condition: ({ newRecord, oldRecord }) =>
    newRecord.status === "completed" && oldRecord.status !== "completed",
});
```

**Schedule Trigger** - Fires on a cron schedule:

```typescript
scheduleTrigger({ cron: "*/5 * * * *" });
scheduleTrigger({ cron: "0 9 * * 1" });
scheduleTrigger({ cron: "0 0 1 * *" });
scheduleTrigger({ cron: "0 * * * *", timezone: "Asia/Tokyo" });
```

**Incoming Webhook Trigger** - Fires when an external webhook is received:

```typescript
incomingWebhookTrigger<WebhookPayload>();
```

**Resolver Executed Trigger** - Fires when a resolver is executed:

```typescript
resolverExecutedTrigger({
  resolver: createOrderResolver,
  condition: ({ result, error }) => !error && result?.order?.id,
}
```

#### Execution Targets

**executeFunction / executeJobFunction** - Execute JavaScript/TypeScript functions:

```typescript
createExecutor({
  operation: {
    kind: "function",
    body: async ({ newRecord }) => {
      console.log("New record created:", newRecord);
    },
  },
});
```

**executeWebhook** - Call external webhooks with dynamic data:

```typescript
createExecutor({
  operation: {
    kind: "webhook",
    url: ({ newRecord }) =>
      `https://api.example.com/webhooks/${newRecord.type}`,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": { vault: "api-keys", key: "external-api" },
    },
    body: ({ newRecord }) => ({
      id: newRecord.id,
      timestamp: new Date().toISOString(),
      data: newRecord,
    }),
  },
});
```

**executeGql** - Execute GraphQL queries and mutations:

```typescript
createExecutor({
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: gql`
      mutation UpdateUserStatus($id: ID!, $status: String!) {
        updateUser(id: $id, input: { status: $status }) {
          id
          status
          updatedAt
        }
      }
    `,
    variables: ({ newRecord }) => ({
      id: newRecord.userId,
      status: "active",
    }),
  },
});
```

#### Execution Context

Context varies based on trigger type:

**Record trigger context** - For `recordCreatedTrigger`, `recordUpdatedTrigger`, and `recordDeletedTrigger`:

- `typeName`: Name of the TailorDB type
- `newRecord`: New record state (not available for delete triggers)
- `oldRecord`: Previous record state (not available for create triggers)

**Incoming webhook trigger context** - For `incomingWebhookTrigger`:

- `body`: Webhook request body
- `headers`: Webhook request headers
- `method`: HTTP method
- `rawBody`: Raw request body as string

**Resolver executed trigger context** - For `resolverExecutedTrigger`:

- `resolverName`: Name of the resolver
- `result`: Resolver's return value (when execution succeeds)
- `error`: Error object (when execution fails)
