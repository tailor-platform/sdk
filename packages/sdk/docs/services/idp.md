# IdP (Identity Provider)

IdP is a built-in identity provider service for managing user authentication.

## Overview

The Built-in IdP provides:

- User registration and authentication
- OAuth client management
- Integration with Auth service

For the official Tailor Platform documentation, see [Identity Provider Setup](https://docs.tailor.tech/tutorials/setup-auth/setup-identity-provider).

## Configuration

Configure the Built-in IdP using `defineIdp()`:

**Definition Rules:**

- **Multiple IdPs allowed**: You can define multiple IdP instances in your config file
- **Configuration location**: Define in `tailor.config.ts` and add to the `idp` array
- **Uniqueness**: IdP names must be unique across all IdP instances

```typescript
import { defineIdp, defineConfig } from "@tailor-platform/sdk";

const idp = defineIdp("my-idp", {
  clients: ["my-client"],
  permission: {
    create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    read: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    update: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    delete: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    sendPasswordResetEmail: [{ conditions: [], permit: false }],
  },
});

// You can define multiple IdPs
const anotherIdp = defineIdp("another-idp", {
  clients: ["another-client"],
  permission: {
    create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    read: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    update: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    delete: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    sendPasswordResetEmail: [{ conditions: [], permit: false }],
  },
});

export default defineConfig({
  idp: [idp, anotherIdp], // Add all IdPs to the array
});
```

## Options

### permission

Per-operation permission policies for IdP user management. Controls who can create, read, update, delete users, and send password reset emails.

```typescript
defineIdp("my-idp", {
  clients: ["my-client"],
  permission: {
    create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    read: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    update: [
      {
        conditions: [
          [{ user: "role" }, "=", "ADMIN"],
          [{ newIdpUser: "name" }, "!=", { oldIdpUser: "name" }],
        ],
        permit: true,
      },
    ],
    delete: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    sendPasswordResetEmail: [{ conditions: [], permit: false }],
  },
});
```

**Operations:**

- `create` - Controls who can create IdP users
- `read` - Controls who can read IdP users
- `update` - Controls who can update IdP users
- `delete` - Controls who can delete IdP users
- `sendPasswordResetEmail` - Controls who can send password reset emails. The examples above disable this operation; to enable it, use a condition such as `[{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }]`

**Operands:**

- `{ user: "field" }` - Authenticated user's attribute
- `{ idpUser: "field" }` - IdP user field (for create/read/delete). Allowed values: `"id"`, `"name"`, `"disabled"`
- `{ oldIdpUser: "field" }` - Previous IdP user field value (for update only). Allowed values: `"id"`, `"name"`, `"disabled"`
- `{ newIdpUser: "field" }` - New IdP user field value (for update only). Allowed values: `"id"`, `"name"`, `"disabled"`
- Literal values: `string`, `boolean`, `string[]`, `boolean[]`

**Operators:** `"="`, `"!="`, `"in"`, `"not in"`

**Helper:** `unsafeAllowAllIdPPermission` grants full access without conditions. Intended only for development and testing.

```typescript
import { unsafeAllowAllIdPPermission } from "@tailor-platform/sdk";

defineIdp("my-idp", {
  clients: ["my-client"],
  permission: unsafeAllowAllIdPPermission,
});
```

### clients

OAuth client names that can use this IdP:

```typescript
defineIdp("my-idp", {
  clients: ["default-client", "mobile-client"],
});
```

### authorization (optional, legacy)

Legacy access control field. Use `permission` instead for fine-grained per-operation control. This field is kept for backward compatibility.

```typescript
defineIdp("my-idp", {
  clients: ["default-client"],
  authorization: "loggedIn", // Only logged-in users can manage
});
```

**Values:**

- `"insecure"` - No authentication required (use only for development)
- `"loggedIn"` - Requires authenticated user
- `{ cel: "<expression>" }` - Custom authorization logic using CEL

### emailConfig

Namespace-level email configuration defaults. Per-request values take priority over these defaults.

```typescript
defineIdp("my-idp", {
  clients: ["my-client"],
  permission: {
    create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    read: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    update: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    delete: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    sendPasswordResetEmail: [{ conditions: [], permit: false }],
  },
  emailConfig: {
    fromName: "My App",
    passwordResetSubject: "Reset your password",
  },
});
```

**Fields:**

- `fromName` - Default sender display name for emails. Empty means use mailer default.
- `passwordResetSubject` - Default subject for password reset emails. Empty means use localized default.

**Validation:** Each field must be 200 characters or less and must not contain newline characters.

## Using idp.provider()

The `idp.provider()` method creates a type-safe reference to the IdP for use in Auth configuration. The client name is validated at compile time against the clients defined in the IdP.

```typescript
import { defineIdp, defineAuth, defineConfig } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

const idp = defineIdp("my-idp", {
  clients: ["default-client", "mobile-client"],
  permission: {
    create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    read: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    update: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    delete: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    sendPasswordResetEmail: [{ conditions: [], permit: false }],
  },
});

const auth = defineAuth("my-auth", {
  userProfile: {
    type: user,
    usernameField: "email",
    attributes: { role: true },
  },
  // Type-safe: only "default-client" or "mobile-client" are allowed
  idProvider: idp.provider("my-provider", "default-client"),
});

export default defineConfig({
  idp: [idp],
  auth,
});
```

**Parameters:**

```typescript
idp.provider(
  "provider-name", // Name for the provider reference
  "client-name", // Must be one of the clients defined in the IdP
);
```

The second argument only accepts client names that were defined in the `clients` array of the IdP configuration.
