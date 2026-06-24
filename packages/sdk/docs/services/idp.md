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
- `sendPasswordResetEmail` - Controls who can send password reset emails. Required unless `userAuthPolicy.disablePasswordAuth` is `true` (the password-reset flow has no meaning when password authentication is off). Set `[{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }]` to allow, or `[]` to deny.
- `unenrollMfa` - Controls who can remove an enrolled MFA factor from a user. Required when `userAuthPolicy.enableMfa` is `true`; omit otherwise. Typically restricted to administrators.

**Policy fields:** each entry in an operation's policy array supports:

- `conditions` - Array of conditions evaluated for the policy (see Operands/Operators below)
- `permit` - Whether to allow (`true`) or deny (`false`) when the conditions match
- `description` - (Optional) Human-readable description of the policy

**Operands:**

- `{ user: "field" }` - Authenticated user's attribute. Built-in fields: `"id"` (user ID), `"_loggedIn"` (boolean, whether the user is authenticated). User-defined attributes (e.g., `"role"`) are also available when configured via `userProfile.attributes` or `machineUserAttributes` in `defineAuth()`
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

### userAuthPolicy

User authentication policy. Controls password requirements, the identifier used for login, allowed email domains, and social login providers. Every field is optional. The boolean options default to disabled, and the password length fields default to a minimum of 6 and a maximum of 4096.

```typescript
defineIdp("my-idp", {
  clients: ["my-client"],
  userAuthPolicy: {
    useNonEmailIdentifier: false,
    allowSelfPasswordReset: true,
    passwordRequireUppercase: true,
    passwordRequireLowercase: true,
    passwordRequireNonAlphanumeric: true,
    passwordRequireNumeric: true,
    passwordMinLength: 8,
    passwordMaxLength: 128,
  },
});
```

**Login behavior:**

- `useNonEmailIdentifier` - Allow a non-email identifier (username) instead of requiring an email address. Default `false`.
- `allowSelfPasswordReset` - Show the "Forgot password?" flow so users can reset their own password. Default `false`.
- `disablePasswordAuth` - Remove password authentication entirely. Default `false`. Requires at least one social login provider to be enabled.

**Password requirements:**

- `passwordRequireUppercase` - Require at least one uppercase letter. Default `false`.
- `passwordRequireLowercase` - Require at least one lowercase letter. Default `false`.
- `passwordRequireNumeric` - Require at least one numeric character. Default `false`.
- `passwordRequireNonAlphanumeric` - Require at least one non-alphanumeric character. Default `false`.
- `passwordMinLength` - Minimum password length. Must be between 6 and 30. Default `6`.
- `passwordMaxLength` - Maximum password length. Must be between 6 and 4096. Default `4096`.

**Email domains and social login:**

- `allowedEmailDomains` - Restrict registration to these email domains. An empty list (the default) allows all domains, but a non-empty list is required when `allowGoogleOauth` or `allowMicrosoftOauth` is enabled.
- `allowGoogleOauth` - Enable the "Sign in with Google" button. Default `false`.
- `allowMicrosoftOauth` - Enable the "Sign in with Microsoft" button. Default `false`.

**MFA (TOTP):**

```typescript
import { defineIdp, defineStaticWebSite } from "@tailor-platform/sdk";

const website = defineStaticWebSite("my-frontend", { description: "App frontend" });

defineIdp("my-idp", {
  clients: ["my-client"],
  userAuthPolicy: {
    enableMfa: true,
    requireMfa: false,
    allowedReturnOrigins: [website.url, "https://admin.example.com"],
    mfaIssuer: "My App",
  },
});
```

- `enableMfa` - Make TOTP MFA available for users in this namespace. Default `false`. When enabled, users can register an authenticator app (Google Authenticator, 1Password, etc.) from the IdP self-service page.
- `requireMfa` - Force password-authenticated users to enroll and pass an MFA challenge on each sign-in. Default `false`. Social sign-in (`allowGoogleOauth` / `allowMicrosoftOauth`) is not affected; the upstream provider's MFA covers those sessions.
- `allowedReturnOrigins` - Origins the IdP self-service pages (such as `/mfa/settings`) are allowed to redirect back to. Each entry is either a literal origin (`https://app.example.com`, scheme + host + optional port, no path/query/fragment) or a static-website placeholder `<name>:url` (e.g. `website.url`) that the CLI resolves to the deployed website's URL at apply time. Required when `enableMfa` is `true`.
- `mfaIssuer` - Label shown next to the user account in authenticator apps when TOTP is enrolled. Up to 64 characters. Falls back to `"Tailor Platform IdP"` when empty.

**Constraints:** the following combinations are rejected at parse time.

- `passwordMinLength` must be less than or equal to `passwordMaxLength`.
- A non-empty `allowedEmailDomains` cannot be combined with `useNonEmailIdentifier: true` (an empty list is allowed). Enabling `allowGoogleOauth` or `allowMicrosoftOauth` is likewise rejected with `useNonEmailIdentifier: true` (leaving them `false` or unset is fine).
- `allowGoogleOauth` requires a non-empty `allowedEmailDomains`.
- `allowMicrosoftOauth` requires both a non-empty `allowedEmailDomains` and `disablePasswordAuth: true`.
- `disablePasswordAuth` requires `allowGoogleOauth` or `allowMicrosoftOauth`, and cannot be combined with `allowSelfPasswordReset`.
- `requireMfa: true` requires `enableMfa: true`.
- `enableMfa: true` requires at least one entry in `allowedReturnOrigins`.

### gqlOperations

Controls which GraphQL user-management operations the IdP exposes. All operations are enabled by default. Use this to turn operations off entirely, independent of the `permission` policies that decide who may call them.

```typescript
defineIdp("my-idp", {
  clients: ["my-client"],
  gqlOperations: {
    create: true,
    read: true,
    update: true,
    delete: false,
    sendPasswordResetEmail: false,
  },
});
```

**Fields:** each field defaults to `true` (enabled). Set a field to `false` to disable that operation.

- `create` - The `_createUser` mutation.
- `read` - The `_users` and `_user` query operations.
- `update` - The `_updateUser` mutation.
- `delete` - The `_deleteUser` mutation.
- `sendPasswordResetEmail` - The `_sendPasswordResetEmail` mutation.

**Shortcut:** pass the string `"query"` to expose a read-only IdP. It enables `read` and disables every mutation.

```typescript
defineIdp("my-idp", {
  clients: ["my-client"],
  gqlOperations: "query",
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

### lang

UI language for the IdP-hosted pages such as the login and password reset screens.

```typescript
defineIdp("my-idp", {
  clients: ["my-client"],
  lang: "ja",
});
```

**Values:** `"en"` or `"ja"`.

### publishUserEvents

Publish IdP user lifecycle events (`idp.user.created`, `idp.user.updated`, `idp.user.deleted`). These events are consumed by executors that use `idpUserCreatedTrigger`, `idpUserUpdatedTrigger`, `idpUserDeletedTrigger`, or `idpUserTrigger`.

```typescript
defineIdp("my-idp", {
  clients: ["my-client"],
  publishUserEvents: true,
});
```

**Auto-configuration:** When `publishUserEvents` is omitted, the SDK enables it automatically during `apply` for each IdP that is targeted by an executor's `idpUser` trigger. Targeting is per-IdP: an executor specifies which IdP it subscribes to via the trigger's `idp` option (required in multi-IdP projects). Set the value explicitly to override:

- `publishUserEvents: true`: always publish events.
- `publishUserEvents: false`: never publish events. `apply` rejects this with an error if any executor's `idpUser` trigger targets this IdP — either remove `publishUserEvents: false` or remove the matching trigger.

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
