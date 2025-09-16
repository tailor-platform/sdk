# Tailor SDK

Development kit for building applications on the Tailor Platform.

## Table of Contents

- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [TailorDB](#tailordb)
- [Pipeline](#pipeline-1)
- [Executor](#executor)
- [Generators](#generators)
- [CLI Commands](#cli-commands)

## Getting Started

### 1. Create a new Tailor SDK project

The easiest way to create a new SDK project is using the init command:

```bash
npx @tailor-platform/tailor-sdk init my-first-sdk
```

For setup, select the following options:

- `Select deployment region`: Choose `Asia Northeast`
- `Select project template`: Choose `Basic`

Once setup is complete, navigate to the newly created directory as prompted.

```bash
cd my-first-sdk
```

The project includes the following key components:

- `tailor.config.ts`: Tailor SDK configuration file
- `src/tailordb/`: TailorDB service definitions directory
- `src/resolvers/`: Pipeline service definitions directory

### 2. Deploy your project

Before deploying your project, you need to create a corresponding workspace using either tailorctl or the console.

```bash
tailorctl auth login
tailorctl workspace create --name my-first-sdk --region asia-northeast
```

Next, run the apply command to deploy your project:

```bash
npm run deploy
```

You can now open the GraphQL Playground and execute the `hello` query:

```graphql
query {
  hello(input: { name: "sdk" }) {
    message
  }
}
```

### 3. Edit your project

Let's try editing `src/resolvers/hello/resolver.ts`:

```typescript
import { createQueryResolver, t } from "@tailor-platform/tailor-sdk";

export default createQueryResolver(
  "hello",
  t.type({
    name: t.string(),
  }),
)
  .fnStep("greet", async (context) => {
    // return `Hello, ${context.input.name}!`;
    return `Goodbye, ${context.input.name}!`;
  })
  .returns(
    (context) => ({
      message: context.greet,
    }),
    t.type({
      message: t.string(),
    }),
  );
```

Deploy again and you'll see that the `hello` query response has been updated:

```bash
npm run deploy
```

## Configuration

Tailor SDK uses TypeScript for configuration files.
By default, it uses `tailor.config.ts` in the project root.
You can specify a different path using the `--config` option.

### name, region

Specify target workspace for deployment.
Deployment will fail if name and region don't match the current tailorctl context.
To specify a workspace without using tailorctl information, use the id field instead.

### id

Specify workspace ID in UUID format.

### app

Specify application settings as a map.
Key becomes application name, and value is configuration object.

#### cors

Specify CORS settings as an array.
You can also specify Static Website URLs in the format `<staticWebsiteName>:url`.

#### allowedIPAddresses

Specify IP addresses allowed to access the application.

#### disableIntrospection

Disable GraphQL introspection. Default is `false`.

#### db

Specify TailorDB service settings as a map.
Key becomes TailorDB service name, and value is configuration object.

- files: Specify an array of glob patterns for definition files.

#### pipeline

Specify Pipeline service settings as a map.
Key becomes Pipeline service name, and value is configuration object.

- files: Specify an array of glob patterns for definition files.

#### idp

Specify IDP service settings as a map.
Key becomes IDP service name, and value is configuration object.

- authorization: Specify conditions for executing user management queries.
  - insecure: Allow all users.
  - loggedIn: Allow logged-in users.
  - cel: Specify a custom CEL expression.
- clients: Specify an array of OAuth client names.

#### auth

Specify Auth service settings as a map.

> [!WARNING]
> Auth configuration interface is expected to undergo significant changes in future releases.
> For current configuration examples, please refer to examples directory.

## TailorDB

Define TailorDB Types in files matching glob patterns specified in `tailor.config.ts`.

### Field

Define TailorDB Fields using methods like db.string(), db.int(), etc.

All TailorDB Field types are supported.

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

For enum fields, specify allowed values as arguments:

```typescript
db.enum("red", "green", "blue");
db.enum(
  { value: "active", description: "Active status" },
  { value: "inactive", description: "Inactive status" },
);
```

For object fields, specify field structure as an argument:

```typescript
db.object({
  street: db.string(),
  city: db.string(),
  country: db.string(),
});
```

#### optional / array

You can make fields optional or arrays by specifying options when creating field:

```typescript
db.string({ optional: true }); // string | null
db.string({ array: true }); // string[]
db.string({ optional: true, array: true }); // string[] | null
```

By specifying assertNonNull option along with optional, you can create a field that doesn't allow null in TypeScript types but does allow null in TailorDB.
This is useful for fields like createdAt where non-null values are set through hooks.

```typescript
const optionalField = db
  .string({ optional: true })
  .hooks({
    create: () => "initial value", // return type is string | null
    update: () => "updated value", // return type is string | null
  })
  .validate(({ value }) => value !== ""); // value type is string | null

type optionalField = t.infer<typeof optionalField>; // type is string | null

const assertNonNullField = db
  .string({ optional: true, assertNonNull: true })
  .hooks({
    create: () => "initial value", // return type is string
    update: () => "updated value", // return type is string
  })
  .validate(({ value }) => value !== ""); // value type is string

type assertNonNullField = t.infer<typeof assertNonNullField>; // type is string
```

> [!WARNING]
> The assertNonNull option only affects TypeScript's type system and doesn't affect the created TailorDB Field.
> If hooks or application logic don't guarantee that a non-null value will be set, the actual value may not match the type.

#### description

Add a description to field:

```typescript
db.string().description("User's full name");
```

#### index / unique

Add an index to field.
Use unique instead of index to create an index with a unique constraint:

```typescript
db.string().index(); // Creates an index
db.string().unique(); // Creates a unique index
```

#### relation

Add a relation to field.
An index and foreign key constraint are automatically configured.

```typescript
const user = db.type("User", {
  name: db.string(),
  roleId: db.uuid().relation({
    type: "n-1",
    toward: { type: role },
  }),
});

const role = db.type("Role", {
  name: db.string(),
});
```

By specifying `type: "keyOnly"`, you can set only the foreign key constraint without creating a relation:

```typescript
const user = db.type("User", {
  name: db.string(),
  roleId: db.uuid().relation({
    type: "keyOnly",
    toward: { type: role },
  }),
});

const role = db.type("Role", {
  name: db.string(),
});
```

By specifying `type: "1-1"`, you can create a one-to-one relation.
In this case, a unique constraint is also automatically configured:

```typescript
const user = db.type("User", {
  name: db.string(),
});

const userProfile = db.type("UserProfile", {
  // userId is a unique field
  userId: db.uuid().relation({
    type: "1-1",
    toward: { type: user },
  }),
  bio: db.string(),
});
```

By default, a relation is created against the id field of the specified TailorDB Type.
You can create a relation against a different field using `toward.key` option:

```typescript
const user = db.type("User", {
  email: db.string().unique(),
});

const userProfile = db.type("UserProfile", {
  userEmail: db.string().relation({
    type: "1-1",
    toward: { type: user, key: "email" },
  }),
  bio: db.string(),
});
```

By default, the relation name is automatically determined.
You can customize relation name using `toward.as` / `backward` options:

```typescript
const user = db.type("User", {
  name: db.string(),
});

const userProfile = db.type("UserProfile", {
  userId: db.uuid().relation({
    type: "1-1",
    toward: { type: user, as: "base" },
    backward: "profile",
  }),
  bio: db.string(),
});
```

#### hooks

Add hooks to field.
You can specify functions to be executed during data creation or update:

```typescript
db.created().hooks({
  create: ({ value }) => `Created: ${value}`,
  update: ({ value }) => `Updated: ${value}`,
});
```

Function arguments include the following properties:

- `value`: Field value being created or updated
- `data`: Entire record value
- `user`: Information about the user performing the operation

> [!NOTE]
> Due to TypeScript type inference limitations, field hooks cannot accurately determine entire record type, so data type is unknown.
> If you need to reference data, use TailorDB Type hooks instead of field hooks.

#### validate

Add a validation function to field:

```typescript
db.string().validate(
  ({ value }) => value.length > 5,
  [
    ({ value }) => value.length < 10,
    "Value must be shorter than 10 characters",
  ],
);
```

Function arguments include the same properties as hooks.
value / data receive values after hooks have been executed.

- `value`: Field value being created or updated
- `data`: Entire record value
- `user`: Information about the user performing the operation

> [!NOTE]
> Similar to hooks, data type is unknown. If you need to reference data, use TailorDB Type validate instead of field validate.

#### vector

Enable field for vector search:

```typescript
db.string().vector();
```

#### serial

Enable field auto-increment.
Can be used with int / string fields:

```typescript
db.int().serial({
  start: 0,
});
db.string().serial({
  start: 0,
});
```

You can specify the upper limit of the serial value by specifying the `maxValue` option:

```typescript
db.int().serial({
  start: 0,
  maxValue: 100,
});
```

For string fields, you can specify the serial value format by specifying the `format` option:

```typescript
db.string().serial({
  start: 0,
  format: "CUST_%d", // CUST_0, CUST_1, ...
});
```

#### common fields

Add common fields using built-in helper:

```typescript
export const user = db.type("User", {
  name: db.string(),
  ...db.fields.timestamps(), // Adds createdAt and updatedAt
});
```

### Type

Define a TailorDB Type using db.type() method:

```typescript
db.type("User", {
  name: db.string(),
});
```

You can specify PluralForm by passing an array as first argument:

```typescript
db.type(["User", "UserList"], {
  name: db.string(),
});
```

You can also pass a description as second argument:

```typescript
db.type("User", "User in the system", {
  name: db.string(),
  description: db.string().optional(),
});
```

#### indexes

Configure composite indexes:

```typescript
db.type("User", {
  firstName: db.string(),
  lastName: db.string(),
}).indexes({ fields: ["firstName", "lastName"] });
```

You can create an index with unique constraint by specifying `unique: true`:

```typescript
db.type("User", {
  firstName: db.string(),
  lastName: db.string(),
}).indexes({ fields: ["firstName", "lastName"], unique: true });
```

You can customize index name by specifying `name` option:

```typescript
db.type("User", {
  firstName: db.string(),
  lastName: db.string(),
}).indexes({
  fields: ["firstName", "lastName"],
  name: "user_name_idx",
});
```

#### files

Add file fields:

```typescript
db.type("User", {
  name: db.string(),
}).files({
  avatar: "profile image",
});
```

#### features

Enable additional features:

- aggregation: Enable aggregation queries.
- bulkUpsert: Enable bulkUpsert queries.

```typescript
db.type("User", {
  name: db.string(),
}).features({
  aggregation: true,
  bulkUpsert: true,
});
```

#### permission

Configure Permission.
For details about Permission, see the [TailorDB documentation](https://docs.tailor.tech/guides/tailordb/permission).

```typescript
db.type("User", {
  name: db.string(),
  role: db.enum("admin", "user").index(),
}).permission<{ role: string }>({
  create: [[{ user: "role" }, "=", "admin"]],
  read: [
    [{ user: "role" }, "=", "admin"],
    [{ record: "id" }, "=", { user: "id" }],
  ],
  update: [[{ user: "role" }, "=", "admin"]],
  delete: [[{ user: "role" }, "=", "admin"]],
});
```

In above example, users with the admin role can freely manipulate User records, while users without the admin role can only read their own records.

> [!NOTE]
> Following the secure-by-default principle, all operations are denied if permissions are not configured.

#### gqlPermission

Configure GQLPermission.
For details about GQLPermission, see the [TailorDB documentation](https://docs.tailor.tech/guides/tailordb/permission).

```typescript
db.type("User", {
  name: db.string(),
  role: db.enum("admin", "user").index(),
}).gqlPermission<{ role: string }>([
  { conditions: [[{ user: "role" }, "=", "admin"]], actions: "all" },
  { conditions: [[{ user: "role" }, "=", "user"]], actions: ["read"] },
]);
```

In above example, users with the admin role can execute all GraphQL queries, while users with the user role can only execute read queries.

> [!NOTE]
> Following the secure-by-default principle, all GraphQL queries are denied if gqlPermission is not configured.

## Pipeline

Define Pipeline Resolvers in files matching glob patterns specified in `tailor.config.ts`.

### Resolver

Define Resolvers using `createQueryResolver` / `createMutationResolver` methods.
`createQueryResolver` corresponds to GraphQL queries, while `createMutationResolver` corresponds to mutations.
Specify Resolver name as first argument and input schema as second.

```typescript
createQueryResolver(
  // Resolver name
  "add",
  // Input schema
  t.type({
    left: t.int(),
    right: t.int(),
  }),
)
  .fnStep("step1", (context) => {
    return context.input.left + context.input.right;
  })
  .returns(
    (context) => ({
      result: context.step1,
    }),
    t.type({
      result: t.int(),
    }),
  );
```

### Input/Output

Define Input/Output schemas using methods of `t` object.
Basic usage and supported field types are the same as TailorDB.
TailorDB-specific options (e.g., index, relation) are not supported.
You can reuse fields defined with `db` object, but note that unsupported options will be ignored:

```typescript
const user = db.type("User", {
  name: db.string().unique(),
  age: db.int(),
});

createQueryResolver(
  "getUser",
  t.type({
    name: user.fields.name,
  }),
)...
```

### Step

Chain multiple steps to define actual resolver logic.
Each step's context includes input and results from previous steps.
Call `returns` as final step to define final output:

```typescript
createQueryResolver(
  "calc",
  t.type({
    value: t.int(),
  }),
)
  .fnStep("add1", (context) => {
    return context.input.value + 1;
  })
  .fnStep("subtract1", (context) => {
    return context.add1 - 1;
  })
  .returns(
    (context) => ({
      result: context.subtract1,
    }),
    t.type({
      result: t.int(),
    }),
  );
```

#### fnStep

Add a step without database access.

#### sqlStep

Add a step with database access.
Context includes a `client` property that can be used to execute SQL queries.
You need to specify which TailorDB service to use with the `dbNamespace` option when creating resolver or step:

```typescript
createQueryResolver(
  "getUser",
  t.type({
    name: t.string(),
  }),
  { defaults: { dbNamespace: "tailordb" } },
)
  .sqlStep("step1", async (context) => {
    const result = await context.client.execOne<{ id: string } | null>(
      `SELECT id FROM User WHERE name = ? LIMIT 1`,
      [context.input.name],
    );
    return result?.id;
  })
  .returns(
    (context) => ({
      result: context.step1,
    }),
    t.type({
      result: t.uuid({ optional: true }),
    }),
  );
```

If you're generating Kysely types with a generator, you can use `kyselyWrapper` to execute typed queries:

```typescript
createQueryResolver(
  "getUser",
  t.type({
    name: t.string(),
  }),
  { defaults: { dbNamespace: "tailordb" } },
)
  .sqlStep("step1", async (context) =>
    kyselyWrapper(context, async (context) => {
      const query = context.db
        .selectFrom("User")
        .select("id")
        .where("name", "=", context.input.name)
        .limit(1)
        .compile();
      const result = await context.client.exec(query);
      return result[0]?.id;
    }),
  )
  .returns(
    (context) => ({
      result: context.step1,
    }),
    t.type({
      result: t.uuid({ optional: true }),
    }),
  );
```

#### gqlStep

TODO

#### returns

Define final output.
Similar to fnStep, except you specify output schema as second argument.

## Executor

Define Executors in files matching glob patterns specified in `tailor.config.ts`.

Executors follow a simple pattern:

1. Create an executor with `createExecutor(name, description)`
2. Add a trigger with `.on(...)`
3. Choose a target: `.executeFunction({ ... })`, `.executeJobFunction({ ... })`, `.executeWebhook({ ... })`, or `.executeGql({ ... })`

```typescript
createExecutor("user-welcome", "Send welcome email to new users")
  .on(
    recordCreatedTrigger(
      user,
      ({ newRecord }) => !!newRecord.email && newRecord.isActive,
    ),
  )
  .executeFunction({
    fn: async ({ newRecord, client }) => {
      // Send welcome email logic here
    },
  });
```

### Trigger

#### Record trigger

- `recordCreatedTrigger(type, filter?)`: Fires when a new record is created
- `recordUpdatedTrigger(type, filter?)`: Fires when a record is updated
- `recordDeletedTrigger(type, filter?)`: Fires when a record is deleted

Each trigger can include an optional filter function:

```typescript
recordUpdatedTrigger(
  order,
  ({ newRecord, oldRecord }) =>
    newRecord.status === "completed" && oldRecord.status !== "completed",
);
```

#### Schedule trigger

- `scheduleTrigger(cron, timezone?)`: Fires on a cron schedule

Use cron expressions. Optional timezone defaults to `UTC`.

```typescript
scheduleTrigger("*/5 * * * *"); // Every 5 minutes
scheduleTrigger("0 9 * * 1"); // Every Monday at 9 AM
scheduleTrigger("0 0 1 * *"); // First day of every month
scheduleTrigger("0 * * * *", "Asia/Tokyo"); // With timezone
```

#### Incoming webhook triggers

- `incomingWebhookTrigger<T>()`: Fires when an external webhook is received

Use typed payloads for type safety:

```typescript
incomingWebhookTrigger<WebhookPayload>();
```

#### Resolver executed triggers

- `resolverExecutedTrigger(resolver, filter?)`: Fires when a pipeline resolver is executed

Filter based on execution results:

```typescript
resolverExecutedTrigger(
  createOrderResolver,
  ({ result, error }) => !error && result?.order?.id, // Only trigger on successful executions
);
```

### Target

Executors support different execution methods depending on your use case:

#### executeFunction / executeJobFunction

Execute JavaScript/TypeScript functions directly. Pass an options object:

```typescript
import sqlstring from "sqlstring";

...
.executeFunction({
  fn: async ({ newRecord, client }) => {
    const query = sqlstring.format(
      /* sql */ `SELECT * FROM "Order" WHERE customerId = ?`,
      [newRecord.id],
    );
    const result = await client.exec(query);
    console.log(`Found ${result.length} orders for customer`);
  },
  dbNamespace: "my-db", // optional
  // invoker: { authName: "auth-namespace", machineUser: "mu-name" },
})
```

#### executeWebhook

Call external webhooks with dynamic data:

```typescript
...
.executeWebhook({
  url: ({ newRecord }) => `https://api.example.com/webhooks/${newRecord.type}`,
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": { vault: "api-keys", key: "external-api" }, // Vault integration
  },
  body: ({ newRecord }) => ({
    id: newRecord.id,
    timestamp: new Date().toISOString(),
    data: newRecord,
  }),
})
```

Securely access secrets for webhook authentication:

```typescript
.executeWebhook({
  headers: {
    "X-API-Key": { vault: "external-apis", key: "partner-api-key" },
  },
})
```

#### executeGql

Execute GraphQL queries and mutations:

```typescript
...
.executeGql({
  appName: "my-app",
  // You can use gql.tada or a plain string. Example with gql.tada:
  // import { graphql as gql } from "gql.tada";
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
})
```

### Execution Context

Execution context varies based on trigger type:

#### Record trigger context

For `recordCreatedTrigger`, `recordUpdatedTrigger`, and `recordDeletedTrigger`:

- `newRecord`: New record state (not available for delete triggers)
- `oldRecord`: Previous record state (only for update triggers)
- `client`: Database client with methods:
  - `exec<T>(sql: string, params?: readonly unknown[])` → `T[]`
  - `execOne<T>(sql: string, params?: readonly unknown[])` → `T`

#### Schedule trigger context

For `scheduleTrigger`:

- `client`: Same database client as above

#### Incoming webhook trigger context

For `incomingWebhookTrigger`:

- `payload`: Webhook request body (typed)
- `headers`: Webhook request headers
- `client`: Same `SqlClient` as above

#### Resolver executed trigger context

For `resolverExecutedTrigger`:

- `result`: Resolver's return value (when execution succeeds)
- `error`: Error object (when execution fails)
- `input`: Input that was passed to resolver
- `client`: Same `SqlClient` as above

### Advanced Features

#### Conditional execution

Use filters to control when executors run:

```typescript
.on(
  recordUpdatedTrigger(product, ({ newRecord, oldRecord }) => {
    // Only trigger if price decreased by more than 10%
    return newRecord.price < oldRecord.price * 0.9;
  })
)
```

## Generators

SDK includes built-in code generators:

- `@tailor/kysely-type`: Generate Kysely table types from TailorDB
- `@tailor/db-type`: Generate TypeScript types for TailorDB models

Configure generators in your `tailor.config.ts`:

```typescript
export default defineConfig({
  // ...
  generators: [
    [
      "@tailor/kysely-type",
      { distPath: ({ tailorDB }) => `./src/generated/${tailorDB}.ts` },
    ],
    [
      "@tailor/db-type",
      { distPath: ({ tailorDB }) => `./src/tailordb/${tailorDB}.types.ts` },
    ],
  ],
});
```

## CLI Commands

SDK provides the following CLI commands:

```bash
# Initialize a new project
npx @tailor-platform/tailor-sdk init [project-name]

# Generate code (to .tailor-sdk/ and your generator outputs)
npx @tailor-platform/tailor-sdk generate

# Watch mode - regenerate on file changes
npx @tailor-platform/tailor-sdk generate --watch

# Apply (bundle resolvers/executors and apply to Tailor Platform)
npx @tailor-platform/tailor-sdk apply

# Dry run
npx @tailor-platform/tailor-sdk apply --dry-run

# Common options
#   --config, -c     Path to tailor.config.ts (default: tailor.config.ts)
#   --env-file, -e   Load environment from a file
```

### Environment Variables

Configure these environment variables for deployment:

```bash
# Option 1: Provide an access token directly
export TAILOR_TOKEN=...  # Personal access token

# Option 2: Use tailorctl authentication (preferred for long-lived dev)
#   SDK reads ~/.tailorctl/config and refreshes tokens automatically.

# Optional: override API base URL (default: https://api.tailor.tech)
export PLATFORM_URL=https://api.tailor.tech
```

### Outputs

- Bundled functions and executors are written under `.tailor-sdk/`.
- You can customize output root with `TAILOR_SDK_OUTPUT_DIR`.
