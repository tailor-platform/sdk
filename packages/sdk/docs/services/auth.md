# Auth

Auth is a service for configuring authentication and authorization in your Tailor Platform application.

## Overview

Auth provides:

- User profile mapping to TailorDB types
- Machine users for service-to-service authentication
- OAuth 2.0 client configuration
- Identity provider integration

For the official Tailor Platform documentation, see [Auth Guide](https://docs.tailor.tech/guides/auth/overview).

## Configuration

Configure Auth service using `defineAuth()`:

```typescript
import { defineAuth } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

const auth = defineAuth("my-auth", {
  userProfile: {
    type: user,
    usernameField: "email",
    attributes: { role: true },
  },
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

**usernameField**: The field in the TailorDB type used as the username. This field must have a unique constraint (`.unique()`) since it is used to uniquely identify users.

**attributes**: Specifies which fields from the TailorDB type are used as user attributes. Set to `true` to enable a field. Enabled attributes must be assigned values in all machine user definitions.

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

**attributes**: Values for attributes enabled in `userProfile.attributes`. All fields marked as `true` in `userProfile.attributes` must be set here. These values are accessible via `user.attributes`:

```typescript
// In a resolver
body: (context) => {
  const role = context.user.attributes?.role;
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

### Using auth.invoker()

The `auth.invoker()` method creates a type-safe reference to a machine user for use in workflow triggers. This specifies which machine user's permissions should be used when executing the workflow.

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
import { auth } from "../tailor.config";
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
      { authInvoker: auth.invoker("admin-machine-user") },
    );
    return { workflowRunId };
  },
  output: t.object({
    workflowRunId: t.string(),
  }),
});
```

The `invoker()` method is type-safe and only accepts machine user names defined in the auth configuration.

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

## CLI Commands

Manage Auth resources using the CLI:

```bash
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
