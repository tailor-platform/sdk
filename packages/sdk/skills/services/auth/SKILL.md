---
name: services/auth
description: Use this skill when configuring authentication, authorization, machine users, OAuth2 clients, or identity providers in a Tailor Platform application.
metadata:
  sources:
    - docs/services/auth.md
    - docs/services/idp.md
---

# Auth & IdP Service

Authentication and authorization configuration for Tailor Platform applications using `defineAuth()` and `defineIdp()`.

## Setup

### Minimal Auth with User Profile

```typescript
import { defineAuth, defineIdp, defineConfig } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

const idp = defineIdp("my-idp", {
  authorization: "loggedIn",
  clients: ["web-client"],
});

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
    "web-client": {
      redirectURIs: ["https://example.com/callback"],
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
  idProvider: idp.provider("my-provider", "web-client"),
});

export default defineConfig({
  idp: [idp],
  auth,
});
```

### Minimal Auth without User Profile (Machine Users Only)

```typescript
import { defineAuth, t } from "@tailor-platform/sdk";

const auth = defineAuth("my-auth", {
  machineUserAttributes: {
    role: t.string(),
    isActive: t.bool(),
  },
  machineUsers: {
    "admin-machine-user": {
      attributes: { role: "ADMIN", isActive: true },
    },
  },
});
```

### TailorDB Type for User Profile

The type referenced by `userProfile.type` must have a unique constraint on the username field:

```typescript
import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  email: db.string().unique(), // usernameField MUST have .unique()
  role: db.enum(["admin", "user"]),
  ...db.fields.timestamps(),
});
```

## Core Patterns

### defineAuth() — One Per Application

Each application has exactly one Auth service, defined in `tailor.config.ts`.

**userProfile**: Maps auth identities to a TailorDB type.

- `type` — the TailorDB type storing user records
- `usernameField` — field used as username; **must** have `.unique()` on the TailorDB type
- `attributes` — key-value map; set field to `true` to enable as a user attribute; only ValueOperand types allowed (string, boolean, string[], boolean[])
- `attributeList` — array of UUID-type field names exposed as an ordered list

```typescript
userProfile: {
  type: user,
  usernameField: "email",
  attributes: { role: true },
  attributeList: ["organizationId", "teamId"],
},
```

Accessing attributes and attributeList at runtime:

```typescript
// In resolvers, executors, workflows
body: (context) => {
  const role = context.user.attributes?.role;
  const [orgId, teamId] = context.user.attributeList;
},

// In TailorDB hooks
.hooks({
  field: {
    create: ({ user }) => user.attributeList[0],
  },
})
```

### machineUserAttributes (XOR with userProfile)

Use `machineUserAttributes` when you need machine users but no user profile. You **cannot** define both `userProfile` and `machineUserAttributes` — they are mutually exclusive (enforced at compile time via `never` type).

```typescript
machineUserAttributes: {
  role: t.string(),
  isActive: t.bool(),
  tags: t.string({ array: true }),
},
```

Run `tailor-sdk generate` after changes to update `tailor.d.ts`.

### Machine Users

Service accounts for automated access. All enabled attributes **must** be set on every machine user.

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

When `attributeList` is defined in `userProfile`, machine users must also provide it:

```typescript
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

#### auth.invoker()

Creates a type-safe reference to a machine user for workflow triggers. Only accepts names defined in `machineUsers`.

```typescript
import { auth } from "../tailor.config";
import myWorkflow from "../workflows/my-workflow";

// In a resolver body
const workflowRunId = await myWorkflow.trigger(
  { id: input.id },
  { authInvoker: auth.invoker("admin-machine-user") },
);
```

### OAuth 2.0 Clients

```typescript
oauth2Clients: {
  "web-client": {
    redirectURIs: [
      "https://example.com/callback",
      `${website.url}/callback`, // StaticWebsite URL resolved at deploy time
    ],
    grantTypes: ["authorization_code", "refresh_token"],
    accessTokenLifetimeSeconds: 3600,    // min 60, max 86400
    refreshTokenLifetimeSeconds: 604800, // min 60, max 604800
    requireDpop: true,                   // optional, DPoP enforcement
    description: "Web application client",
  },
},
```

### defineIdp() — Identity Provider

Multiple IdPs are allowed. Names must be unique.

```typescript
import { defineIdp } from "@tailor-platform/sdk";

const idp = defineIdp("my-idp", {
  authorization: "loggedIn",
  clients: ["web-client"],
});
```

**authorization** values:

- `"insecure"` — no auth required (development only, never production)
- `"loggedIn"` — requires authenticated user
- CEL expression string — custom logic, e.g. `"user.role == 'admin'"`

**clients**: array of OAuth client names that can use this IdP.

#### idp.provider()

Creates a type-safe reference for Auth configuration. The client name is validated at compile time against the IdP's `clients` array.

```typescript
idProvider: idp.provider("my-provider", "web-client"),
//                        ^ provider name  ^ must match a client in the IdP
```

### CLI Commands

```bash
tailor-sdk machineuser list              # List machine users
tailor-sdk machineuser token <name>      # Get machine user token
tailor-sdk oauth2client list             # List OAuth2 clients
tailor-sdk oauth2client get <name>       # Get OAuth2 client credentials
```

## Common Mistakes

### CRITICAL: Defining both userProfile and machineUserAttributes

These are mutually exclusive. The SDK enforces this with a `never` type at compile time.

```typescript
// WRONG — will not compile
defineAuth("my-auth", {
  userProfile: { ... },
  machineUserAttributes: { ... }, // compile error
});
```

Choose one:

- `userProfile` — when you have end users backed by a TailorDB type
- `machineUserAttributes` — when you only have machine users

### HIGH: Missing .unique() on usernameField

The field referenced by `usernameField` must have `.unique()` on the TailorDB type. Without it, user lookup will fail at runtime.

```typescript
// WRONG
email: db.string(), // missing .unique()

// CORRECT
email: db.string().unique(),
```

### HIGH: Machine user missing required attributes

Every attribute enabled in `userProfile.attributes` (or defined in `machineUserAttributes`) must be set on every machine user. Omitting any attribute causes a build error.

```typescript
// Given: attributes: { role: true, isActive: true }

// WRONG — missing isActive
machineUsers: {
  "admin": { attributes: { role: "ADMIN" } },
},

// CORRECT
machineUsers: {
  "admin": { attributes: { role: "ADMIN", isActive: true } },
},
```

### MEDIUM: SDK vs Platform API naming confusion

The SDK and Platform API use different names for the same concepts:

| SDK             | Platform API    | Description                      |
| --------------- | --------------- | -------------------------------- |
| `attributes`    | `attribute_map` | Key-value map of user attributes |
| `attributeList` | `attributes`    | Ordered list of UUID values      |

The SDK handles this mapping automatically. Be aware of the difference when reading Platform API docs or responses.

### MEDIUM: Using "insecure" authorization in production

`authorization: "insecure"` on an IdP allows anyone to manage users. This is strictly for local development.

```typescript
// Development only
defineIdp("my-idp", { authorization: "insecure", clients: ["dev-client"] });

// Production — use "loggedIn" or a CEL expression
defineIdp("my-idp", { authorization: "loggedIn", clients: ["web-client"] });
defineIdp("my-idp", { authorization: "user.role == 'admin'", clients: ["web-client"] });
```

## Cross-References

- **services/tailordb** — `userProfile.type` references a TailorDB type; TailorDB permissions use user attributes from Auth
- **services/workflow** — `authInvoker` in workflow triggers requires a machine user defined in Auth
