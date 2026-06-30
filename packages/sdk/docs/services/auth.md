# Auth

Auth is a service for configuring authentication and authorization in your Tailor Platform application.

## Overview

Auth provides:

- User profile mapping to TailorDB types
- Machine users for service-to-service authentication
- OAuth 2.0 client configuration
- Identity provider integration
- Auth connections for external OAuth2 provider integration

For the official Tailor Platform documentation, see [Auth Guide](https://docs.tailor.tech/guides/auth/overview).

## Configuration

Configure Auth service using `defineAuth()`:

**Definition Rules:**

- **One auth per application**: Each application can have exactly one Auth service
- **Configuration location**: Define in `tailor.config.ts` using `defineAuth()` and reference directly in the config's `auth` field
- **`userProfile` and `machineUserAttributes` are mutually exclusive**: Specifying both fails at deploy/generate time with ``Specify either `userProfile` or `machineUserAttributes`, not both.``

```typescript
import { defineAuth } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

const auth = defineAuth("my-auth", {
  userProfile: {
    type: user,
    usernameField: "email",
    attributes: { role: true },
  },
  // Optional when you don't define userProfile:
  // machineUserAttributes: {
  //   role: t.string(),
  // },
  machineUsers: {
    "admin-machine-user": {
      attributes: { role: "ADMIN" },
    },
  },
  oauth2Clients: {
    "my-oauth2-client": {
      redirectURIs: ["https://example.com/callback"],
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
  connections: {
    "google-connection": {
      type: "oauth2",
      providerUrl: "https://accounts.google.com",
      issuerUrl: "https://accounts.google.com",
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  idProvider: idp.provider("my-provider", "my-client"),
});

export default defineConfig({
  auth,
});
```

## User Profile

Maps authenticated identities to a TailorDB type:

```typescript
userProfile: {
  type: user,              // TailorDB type for user records
  usernameField: "email",  // Field used as username (must be unique)
  attributes: {
    role: true,            // Enable 'role' as a user attribute
  },
},
```

Example TailorDB type for user profile:

```typescript
// tailordb/user.ts
import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  email: db.string().unique(), // usernameField must have unique constraint
  role: db.enum(["admin", "user"]),
  ...db.fields.timestamps(),
});
```

**type**: The TailorDB type that stores user records.

**namespace** (optional): The TailorDB namespace where the user type is defined. Usually auto-resolved from your `db` configuration, so you don't need to specify it. Required only when multiple TailorDB namespaces exist and the type lives in an external TailorDB:

```typescript
userProfile: {
  namespace: "external-ns", // Explicitly specify the namespace
  type: user,
  usernameField: "email",
},
```

**usernameField**: The field in the TailorDB type used as the username. This field must have a unique constraint (`.unique()`) since it is used to uniquely identify users.

**attributes**: Specifies which fields from the TailorDB type are used as user attributes. Set to `true` to enable a field. Enabled attributes must be assigned values in all machine user definitions. Only fields with ValueOperand types (string, boolean, string[], boolean[]) can be used as attributes. The `id` field and datetime/date/time types are excluded.

## Attribute List

In addition to `attributes` (key-value map), you can configure `attributeList` to expose UUID-type fields as an ordered list. This is useful for referencing related records by their IDs.

```typescript
userProfile: {
  type: user,
  usernameField: "email",
  attributes: { role: true },
  attributeList: ["organizationId", "teamId"],
},
```

**attributeList**: An array of field names from the TailorDB type. These fields will be exposed as an ordered list of UUIDs. Only UUID-type fields (non-array) can be included in the attribute list.

Example TailorDB type with UUID fields for attribute list:

```typescript
// tailordb/user.ts
import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  email: db.string().unique(),
  role: db.enum(["admin", "user"]),
  organizationId: db.uuid(), // Can be used in attributeList
  teamId: db.uuid(), // Can be used in attributeList
  ...db.fields.timestamps(),
});
```

The `attributeList` values are accessible via `user.attributeList` as a tuple:

```typescript
// In a resolver
body: (context) => {
  const [organizationId, teamId] = context.user.attributeList;
},

// In TailorDB hooks
.hooks({
  field: {
    create: ({ user }) => user.attributeList[0], // First UUID from list
  },
})
```

## Machine User Attributes (without userProfile)

When you want to use machine users without defining a `userProfile`, define `machineUserAttributes` instead. These attributes are used for:

- type-safe `machineUsers[*].attributes`
- `context.user.attributes` typing (via `tailor.d.ts`)

```typescript
import { defineAuth, t } from "@tailor-platform/sdk";

export const auth = defineAuth("my-auth", {
  machineUserAttributes: {
    role: t.string(),
    isActive: t.bool(),
    tags: t.string({ array: true }),
  },
  machineUsers: {
    "admin-machine-user": {
      attributes: { role: "ADMIN", isActive: true, tags: ["root"] },
    },
  },
});
```

To update types in `tailor.d.ts`, run:

```bash
tailor-sdk generate
```

## Machine Users

Service accounts for automated access without user interaction:

```typescript
machineUsers: {
  "admin-machine-user": {
    attributes: { role: "ADMIN" },
  },
  "readonly-machine-user": {
    attributes: { role: "READER" },
  },
},
```

**attributes**: Values for attributes enabled in `userProfile.attributes` (or all fields defined in `machineUserAttributes` when `userProfile` is omitted). All enabled fields must be set here. These values are accessible via `user.attributes`:

```typescript
// In a resolver
body: (context) => {
  const role = context.user.attributes?.role;
},
```

**attributeList**: Values for fields enabled in `userProfile.attributeList`. Must be an array of valid UUIDs in the same order as declared in userProfile:

```typescript
// userProfile with attributeList
userProfile: {
  type: user,
  usernameField: "email",
  attributes: { role: true },
  attributeList: ["organizationId", "teamId"],
},
machineUsers: {
  "admin-machine-user": {
    attributes: { role: "ADMIN" },
    attributeList: [
      "550e8400-e29b-41d4-a716-446655440000",
      "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    ],
  },
},
```

These values are accessible via `user.attributeList`:

```typescript
// In a resolver
body: (context) => {
  const [organizationId, teamId] = context.user.attributeList;
},

// In TailorDB hooks
.hooks({
  field: {
    create: ({ user }) => user.attributes?.role === "ADMIN" ? "default" : null,
  },
})

// In TailorDB validate
.validate({
  field: [
    ({ user }) => user.attributes?.role === "ADMIN",
    "Only admins can set this field",
  ],
})
```

Machine users are useful for:

- CI/CD pipelines
- Background jobs
- Service-to-service communication
- E2E testing

Get a machine user token using the CLI:

```bash
tailor-sdk machineuser token <name>
```

### Specifying a machine user invoker

Resolvers, executors, and `workflow.trigger()` accept an `authInvoker` option that chooses which machine user runs the operation. Pass the machine user name as a plain string — it is type-narrowed to the names you registered in `machineUsers`.

```typescript
// tailor.config.ts
export const auth = defineAuth("my-auth", {
  machineUsers: {
    "admin-machine-user": {
      attributes: { role: "ADMIN" },
    },
  },
  // ... other config
});
```

```typescript
// resolvers/trigger-workflow.ts
import { createResolver, t } from "@tailor-platform/sdk";
import myWorkflow from "../workflows/my-workflow";

export default createResolver({
  name: "triggerMyWorkflow",
  operation: "mutation",
  input: {
    id: t.string(),
  },
  body: async ({ input }) => {
    // Trigger workflow with machine user permissions
    const workflowRunId = await myWorkflow.trigger(
      { id: input.id },
      { authInvoker: "admin-machine-user" },
    );
    return { workflowRunId };
  },
  output: t.object({
    workflowRunId: t.string(),
  }),
});
```

Type narrowing is provided by the generated `tailor.d.ts` (the `MachineUserNameRegistry` interface). Run `tailor-sdk generate` (or `apply`) after defining new machine users to refresh it.

> **Deprecated:** The `auth.invoker("<name>")` helper is still available for backward compatibility. Prefer the string form — it does not require importing `auth` from `tailor.config.ts` into runtime files, avoiding bundling config-layer (Node-only) dependencies.

## OAuth 2.0 Clients

Configure OAuth 2.0 clients for third-party applications:

```typescript
oauth2Clients: {
  "my-oauth2-client": {
    redirectURIs: [
      "https://example.com/callback",
      `${website.url}/callback`,  // Type-safe URL from StaticWebsite
    ],
    description: "My OAuth2 client",
    grantTypes: ["authorization_code", "refresh_token"],
    accessTokenLifetimeSeconds: 3600,    // 1 hour
    refreshTokenLifetimeSeconds: 604800, // 7 days
    requireDpop: true,                   // Require DPoP for this client
  },
},
```

**redirectURIs**: Allowed redirect URIs after authentication.

**description**: Optional description of the client.

**grantTypes**: Supported OAuth 2.0 grant types:

- `authorization_code` - Standard OAuth 2.0 authorization code flow
- `refresh_token` - Allow refreshing access tokens

**accessTokenLifetimeSeconds**: Optional access token lifetime in seconds. Minimum: 60 seconds, Maximum: 86400 seconds (1 day). If not specified, uses platform default.

**refreshTokenLifetimeSeconds**: Optional refresh token lifetime in seconds. Minimum: 60 seconds, Maximum: 604800 seconds (7 days). If not specified, uses platform default.

**requireDpop**: Optional boolean to require DPoP (Demonstrating Proof of Possession) for this client. When set to `true`, the client must use DPoP tokens for authentication. If not specified, DPoP is not required.

Get OAuth2 client credentials using the CLI:

```bash
tailor-sdk oauth2client get <name>
```

## Identity Provider

Connect to an external identity provider:

```typescript
idProvider: idp.provider("my-provider", "my-client"),
```

See [IdP](./idp.md) for configuring identity providers.

## Auth Connections

Auth connections enable OAuth2 authentication with external providers (Google, Microsoft 365, QuickBooks, etc.) for application-to-application flows. Functions can access connection tokens at runtime via `tailor.authconnection.getConnectionToken()`.

For the official Tailor Platform documentation, see [AuthConnection Guide](https://docs.tailor.tech/guides/auth/authconnection).

> [!NOTE]
> Deploy updates connections **in-place**, preserving the OAuth token. Changing `providerUrl`, `issuerUrl`, or `clientId` revokes the current session — the deploy will warn you to re-authorize:
>
> ```bash
> tailor-sdk authconnection authorize --name <connection-name>
> # Or via the Console:
> tailor-sdk authconnection open
> ```

### Setup Flow

Setting up an auth connection requires two steps:

1. **Create** the connection (registers the OAuth2 provider credentials)
2. **Authorize** the connection (runs the OAuth2 flow to obtain and store tokens)

Both steps are needed regardless of whether you manage connections via config or CLI.

### Configuration

Define connections in `defineAuth()`:

```typescript
import { defineAuth } from "@tailor-platform/sdk";

export const auth = defineAuth("my-auth", {
  // ... other auth config
  connections: {
    "google-connection": {
      type: "oauth2",
      providerUrl: "https://accounts.google.com",
      issuerUrl: "https://accounts.google.com",
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
});
```

After `tailor-sdk deploy`, authorize the connection:

```bash
tailor-sdk authconnection authorize --name google-connection \
  --scopes "openid,profile,email"
```

The authorize command opens a browser for the OAuth2 flow. The authorization code is sent to the platform, which exchanges it for tokens using the client secret registered in the connection config.

### Connection Config Fields

| Field          | Type     | Required | Description                                 |
| -------------- | -------- | -------- | ------------------------------------------- |
| `type`         | `string` | Yes      | Connection type. Currently only `"oauth2"`. |
| `providerUrl`  | `string` | Yes      | OAuth2 provider URL.                        |
| `issuerUrl`    | `string` | Yes      | OAuth2 issuer URL for JWT validation.       |
| `clientId`     | `string` | Yes      | OAuth2 client ID.                           |
| `clientSecret` | `string` | Yes      | OAuth2 client secret.                       |
| `authUrl`      | `string` | No       | Override for the authorization endpoint.    |
| `tokenUrl`     | `string` | No       | Override for the token endpoint.            |

### Change Detection

The SDK uses hash-based change detection for the `clientSecret` field. Connections are updated in-place only when the secret or a non-secret field has changed since the last deploy. Deleting the `.tailor-sdk/` directory resets the change-detection state: connections with a non-empty `clientSecret` will be updated on the next deploy to re-send the secret, while connections with an empty `clientSecret` (CI scenario) are only updated if a non-secret field has changed.

> [!NOTE]
> The secret hash lives in `.tailor-sdk/secrets-state.json`, which is gitignored and not shared across machines or CI. When the state is missing, the SDK cannot confirm whether `clientSecret` is unchanged — but it still updates the connection in-place, preserving the token. If `clientSecret` is absent or empty (typical in CI where you do not want to store the secret), the SDK skips the secret field on update and leaves the existing secret on the platform unchanged.

### `auth.getConnectionToken()`

`auth.getConnectionToken()` retrieves connection tokens at runtime by calling `tailor.authconnection.getConnectionToken()` internally. When `connections` is defined in `defineAuth()`, the connection name is type-checked and autocompleted against the defined keys:

```typescript
import { auth } from "../tailor.config";

// In a resolver, executor, or workflow:
const tokens = await auth.getConnectionToken("google-connection");
const response = await fetch("https://www.googleapis.com/...", {
  headers: { Authorization: `Bearer ${tokens.access_token}` },
});

// auth.getConnectionToken("unknown"); // Type error — only "google-connection" is allowed
```

When `connections` is not defined, `getConnectionToken()` accepts any string. This supports connections managed entirely via the CLI.

See [Built-in Interfaces](https://docs.tailor.tech/guides/function/builtin-interfaces.html#auth-connection) for the full runtime API.

### CLI Management

Auth connections can also be managed via the CLI:

```bash
# Open the connections page in the Console (recommended for creating connections/tokens)
tailor-sdk authconnection open

# Authorize (opens browser for OAuth2 flow)
tailor-sdk authconnection authorize --name google-connection

# List all connections
tailor-sdk authconnection list

# Revoke a connection
tailor-sdk authconnection revoke --name google-connection
```

Connection creation is handled by `tailor-sdk deploy` via the config, but recreation on deploy can drop the authorized token (see the warning at the top of this section) — for shared and CI workflows, create connections and tokens from the Console (`tailor-sdk authconnection open`) instead.

See [Auth Resource Commands](../cli/auth.md) for full CLI documentation.

## Before Login Hook

Run custom logic before a user logs in. This is useful for JIT (Just-In-Time) user provisioning — automatically creating or updating user records when a user authenticates for the first time.

```typescript
import { defineAuth } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

export const auth = defineAuth("my-auth", {
  userProfile: {
    type: user,
    usernameField: "email",
  },
  machineUsers: {
    "hook-invoker": {
      attributes: { role: "ADMIN" },
    },
  },
  hooks: {
    beforeLogin: {
      handler: async ({ claims, idpConfigName, env }) => {
        // Provision or update user based on IdP claims
        // `env` exposes the variables defined in `defineConfig({ env })`
      },
      invoker: "hook-invoker",
    },
  },
});
```

**handler**: An async function that receives `{ claims, idpConfigName, env }` and is called before each login. `claims` contains the token claims from the identity provider, `idpConfigName` is the name of the IdP configuration used for authentication, and `env` exposes the environment variables defined in `defineConfig({ env })` (the same values available via `context.env` in resolvers).

**invoker**: The machine user whose permissions are used to execute the hook. Must reference a machine user defined in the same auth configuration.

### Federated identity claims

When a user signs in through a Built-in IdP OAuth provider (Google or Microsoft), the upstream provider's profile is available on `claims.federated_identity`. It is `undefined` for password logins, so guard before reading it. Commonly present claims (`name`, `given_name`, `family_name`, `picture`, `locale`) are typed; any other claim the provider issues is forwarded as-is. Availability varies by provider (for example, Microsoft does not issue `picture`).

```typescript
hooks: {
  beforeLogin: {
    handler: async ({ claims }) => {
      const federated = claims.federated_identity;
      if (federated?.provider === "google") {
        // Populate the user record from the upstream profile
        const avatarUrl = federated.claims.picture;
      }
    },
    invoker: "hook-invoker",
  },
}
```

## CLI Commands

Manage Auth resources using the CLI:

```bash
# Auth connections
tailor-sdk authconnection authorize --name <name>
tailor-sdk authconnection list
tailor-sdk authconnection revoke --name <name>

# List machine users
tailor-sdk machineuser list

# Get machine user token
tailor-sdk machineuser token <name>

# List OAuth2 clients
tailor-sdk oauth2client list

# Get OAuth2 client credentials
tailor-sdk oauth2client get <name>
```

See [Auth Resource Commands](../cli/auth.md) for full documentation.
