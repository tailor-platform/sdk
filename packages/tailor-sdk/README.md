# Tailor SDK

Tailor SDK is a library for building applications on the Tailor Platform using TypeScript.

## Table of Contents

- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [TailorDB](#tailordb)
- [Pipeline](#pipeline-1)
- [Auth](#auth)
- [Executor](#executor)
- [CLI Commands](#cli-commands)

## Getting Started

You can easily start a new project using [`@tailor-platform/create-tailor-sdk`](https://www.npmjs.com/package/@tailor-platform/create-tailor-sdk).

```bash
npm create @tailor-platform/tailor-sdk my-first-sdk --template hello-world
# or
yarn create @tailor-platform/tailor-sdk my-first-sdk --template hello-world
# or
pnpm create @tailor-platform/tailor-sdk my-first-sdk --template hello-world
```

Once your project is set up, follow the generated README to perform your first deployment.

## Configuration

Tailor SDK reads `tailor.config.ts` from the project root by default.
If you want to use a different configuration file, you can specify it with the `--config` option.
In `tailor.config.ts`, export an object defined using the `defineConfig` function as the default export.

```typescript
import { defineConfig } from "@tailor-platform/tailor-sdk";

export default defineConfig({
  workspaceId: "08a05d91-5176-4d26-a04d-439cc7910d5a",
  name: "my-app",
  // ... other configuration
});
```

### workspaceId

The workspace ID where the project will be deployed. This field is required.

```typescript
export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
});
```

### name

The application name. This field is required and should be unique within the workspace.

```typescript
export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
});
```

### cors

A list of origins to configure as CORS for the application.
You can reference static website URLs using the `website.url` property returned by `defineStaticWebSite()`.

```typescript
import { defineStaticWebSite } from "@tailor-platform/tailor-sdk";

const website = defineStaticWebSite("my-website", {
  description: "My website",
});

export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
  cors: ["https://example.com", website.url], // Type-safe URL reference
  staticWebsites: [website],
});
```

### allowedIPAddresses

A list of IP addresses allowed to access the application.
Can be specified in CIDR format.

```typescript
export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
  allowedIPAddresses: ["192.168.0.0/24"],
});
```

### disableIntrospection

Disable GraphQL introspection. Default is `false`.

```typescript
export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
  disableIntrospection: true,
});
```

### db

Glob patterns to load as TailorDB service configuration.
In the following example, all `.ts` files under the `db` directory will be included.

```typescript
export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
  db: {
    tailordb: { files: ["db/**/*.ts"] },
  },
});
```

### pipeline

Glob patterns to load as Pipeline service configuration.
In the following example, all `.ts` files under the `pipeline` directory will be included.

```typescript
export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
  pipeline: {
    "my-pipeline": { files: ["pipeline/**/*.ts"] },
  },
});
```

### idp

Configuration for the Built-in IdP service.

#### authorization

User management permission settings.
Only authorized users can execute user management operations such as `_createUser`.

- `insecure`: Allow all users
- `loggedIn`: Allow logged-in users
- `cel`: Allow with custom CEL expression

For example, to allow only users with a specific ID, configure as follows:

```typescript
export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
  idp: {
    "my-idp": {
      authorization: {
        cel: `user.id == "141d7ef6-f5a5-4b8e-8b2e-cdd08d0b7d5b"`,
      },
    },
  },
});
```

#### clients

A list of OAuth clients to create in the Built-in IdP service.
By specifying the clients created here in the Auth service's idProviderConfigs, you can use the Built-in IdP service for application authentication.

```typescript
export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
  idp: {
    "my-idp": {
      clients: ["my-client"],
    },
  },
});
```

### auth

Configuration for the Auth service.
Specify an object defined using the `defineAuth` function.

```typescript
export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
  auth: defineAuth({
    // ...
  }),
});
```

### executor

Glob patterns to load as Executor service configuration.
In the following example, all `.ts` files under the `executors` directory will be included.

```typescript
export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
  executor: { files: ["executors/**/*.ts"] },
});
```

### staticWebsites

Configuration for the Static Web Hosting service.

Define static websites using `defineStaticWebSite()` which provides type-safe URL references.

```typescript
import { defineStaticWebSite, defineConfig } from "@tailor-platform/tailor-sdk";

const website = defineStaticWebSite("my-website", {
  description: "My Static Website",
  allowedIPAddresses: ["192.168.0.0/24"], // Optional
});

export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
  staticWebsites: [website],
});
```

#### Type-safe URL References

Static websites defined with `defineStaticWebSite()` provide two properties for type-safe URL references:

- **`website.url`**: The base URL of the static website (resolved at deployment time)
- **`website.callbackUrl`**: The callback URL (`<website-url>/callback`) for OAuth flows

These can be used in CORS settings and OAuth2 redirect URIs:

```typescript
import {
  defineStaticWebSite,
  defineAuth,
  defineConfig,
} from "@tailor-platform/tailor-sdk";

const website = defineStaticWebSite("my-frontend", {
  description: "Frontend application",
});

const auth = defineAuth("my-auth", {
  // ...
  oauth2Clients: {
    sample: {
      redirectURIs: [
        "https://example.com/callback",
        website.callbackUrl, // Resolved to actual URL/callback at deployment
      ],
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
});

export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
  cors: [website.url], // Resolved to actual URL at deployment
  auth,
  staticWebsites: [website],
});
```

#### Options

- **description**: Description of the site (optional)
- **allowedIPAddresses**: List of IP addresses allowed to access the site in CIDR format (optional)

### generators

Configuration for code generators executed by the `generate` command.
The following generators are currently provided officially:

#### @tailor/kysely-type

Generates Kysely type definitions corresponding to TailorDB service configuration.
You can specify the path for the generated file with the distPath option.

```typescript
export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
  generators: [
    ["@tailor/kysely-type", { distPath: ({ db }) => `./generated/${db}.ts` }],
  ],
});
```

#### @tailor/db-type

Generates TypeScript type definitions corresponding to TailorDB service configuration.
You can specify the path for the generated file with the distPath option.

```typescript
export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
  generators: [["@tailor/db-type", { distPath: () => `./generated/types.ts` }]],
});
```

## TailorDB

Define TailorDB Types in files matching glob patterns specified in `tailor.config.ts`.

### Field

Define TailorDB Fields using methods like `db.string()`, `db.int()`, etc.

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

Define Resolvers using `createResolver` method.
Specify the resolver configuration including `name`, `operation` (query or mutation), `input`, `body`, and `output`.

```typescript
createResolver({
  // Resolver name
  name: "add",
  // Operation type: "query" or "mutation"
  operation: "query",
  // Input schema
  input: t.type({
    left: t.int(),
    right: t.int(),
  }),
  // Resolver logic
  body: (context) => {
    return {
      result: context.input.left + context.input.right,
    };
  },
  // Output schema
  output: t.type({
    result: t.int(),
  }),
});
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

createResolver({
  name: "getUser",
  operation: "query",
  input: t.type({
    name: user.fields.name,
  }),
  body: (context) => {
    // resolver logic
  },
  output: t.type({
    // output schema
  }),
});
```

### Body Function

The `body` function defines the actual resolver logic.
The context includes `input`, `user`, and `client` properties.

The `client` property can be used to execute SQL queries:

```typescript
createResolver({
  name: "getUser",
  operation: "query",
  input: t.type({
    name: t.string(),
  }),
  body: async (context) => {
    const result = await context.client.execOne<{ id: string } | null>(
      `SELECT id FROM User WHERE name = ? LIMIT 1`,
      [context.input.name],
    );
    return {
      result: result?.id,
    };
  },
  output: t.type({
    result: t.uuid({ optional: true }),
  }),
});
```

If you're generating Kysely types with a generator, you can use `kyselyWrapper` to execute typed queries:

```typescript
createResolver({
  name: "getUser",
  operation: "query",
  input: t.type({
    name: t.string(),
  }),
  body: async (context) => {
    return kyselyWrapper(context, async (context) => {
      const query = context.db
        .selectFrom("User")
        .select("id")
        .where("name", "=", context.input.name)
        .limit(1)
        .compile();
      const result = await context.client.exec(query);
      return {
        result: result[0]?.id,
      };
    });
  },
  output: t.type({
    result: t.uuid({ optional: true }),
  }),
});
```

The body function can be synchronous or asynchronous and should return data matching the output schema.

## Auth

Define Auth services with `defineAuth` to connect identity management with TailorDB. Each entry becomes an Auth namespace in the Tailor Platform.

```typescript
import { defineAuth, defineConfig } from "@tailor-platform/tailor-sdk";
import { user } from "./tailordb/user";

const auth = defineAuth("main-auth", {
  userProfile: {
    type: user,
    usernameField: "email",
    attributes: { role: true, isActive: true },
    attributeList: ["externalId"],
  },
  machineUsers: {
    "admin-service": {
      attributes: { role: "ADMIN", isActive: true },
      attributeList: ["admin-external-id"],
    },
  },
  oauth2Clients: {
    dashboard: {
      redirectURIs: ["https://example.com/callback"],
      grantTypes: ["authorization_code", "refresh_token"],
      clientType: "browser",
    },
  },
});

export default defineConfig({
  workspaceId: process.env.WORKSPACE_ID!,
  name: "my-app",
  db: { tailordb: { files: ["./tailordb/*.ts"] } },
  auth,
});
```

Auth service options:

- **name**: Unique namespace for the Auth service. Matches the identifier used when deploying.
- **userProfile**: Maps identities to a TailorDB type.
  - `type`: TailorDB user type. The SDK resolves the namespace automatically across all configured TailorDB services.
  - `usernameField`: Required unique string field used for sign-in (for example `email`).
  - `attributes`: Optional map of additional TailorDB fields (`true` flag) to expose to identity providers and issued tokens.
  - `attributeList`: Optional list of attribute keys whose values should be propagated as arrays (used by machine users and downstream integrations).
- **machineUsers**: Service accounts provisioned by the platform. Attribute values must correspond to keys enabled in `userProfile.attributes`, and `attributeList` values must follow the order declared in `userProfile.attributeList`.
- **oauth2Clients**: OAuth 2.0 clients issued by the Auth service. `redirectURIs` is required and can include static website URLs using the `website.callbackUrl` property from `defineStaticWebSite()`. `grantTypes` accepts `authorization_code` and/or `refresh_token`. `clientType` defaults to `confidential` and also supports `public` and `browser`.
- **idProvider**: Configure an external identity provider.
  - `OIDC`: Provide `clientID`, a secret reference for `clientSecret`, and the provider `providerURL`. Optional `issuerURL` and `usernameClaim` override defaults.
  - `SAML`: Supply Tailor Vault references for `spCertBase64`/`spKeyBase64` and either `metadataURL` or inline `rawMetadata`.
  - `IDToken`: Integrate providers that issue signed ID tokens directly with `providerURL`, `clientID`, and optional issuer/claim overrides.
  - `BuiltInIdP`: Reuse a Tailor-hosted IdP by referencing an existing IdP namespace (`namespace`) and client (`clientName`). Secrets are resolved automatically during deployment.
- **scim**: Provision SCIM resources for directory synchronization.
  - `machineUserName`: Machine user used for SCIM operations.
  - `authorization`: `bearer` (requires `bearerSecret`) or `oauth2`.
  - `resources`: Describe each SCIM resource, including the target `tailorDBNamespace`, `tailorDBType`, schema, and attribute mappings.
- **tenantProvider**: Enable tenant resolution by specifying the TailorDB `type` that stores tenant records and the `signatureField` used to match incoming tenant signatures.

All secrets referenced in Auth configuration use the Tailor Vault structure `{ VaultName, SecretKey }`. Ensure the secrets exist (via console or `tailorctl`) before running `pnpm run deploy` / `pnpm apply`.

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
...
.executeFunction({
  fn: async ({ newRecord, client }) => {
    const result = await client.exec(
      /* sql */ `SELECT * FROM "Order" WHERE customerId = ?`,
      [newRecord.id],
    );
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

## CLI Commands

SDK provides the following CLI commands:

```bash
# Initialize a new project using create-tailor-sdk
npx @tailor-platform/tailor-sdk init

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
