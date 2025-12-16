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

```typescript
import { defineIdp, defineConfig } from "@tailor-platform/sdk";

const idp = defineIdp("my-idp", {
  authorization: "loggedIn",
  clients: ["my-client"],
});

export default defineConfig({
  idp: [idp],
});
```

## Options

### authorization

User management permissions. Controls who can manage users in the IdP.

```typescript
defineIdp("my-idp", {
  authorization: "loggedIn", // Only logged-in users can manage
});

defineIdp("my-idp", {
  authorization: "insecure", // Anyone can manage (development only)
});

defineIdp("my-idp", {
  authorization: "user.role == 'admin'", // CEL expression
});
```

**Values:**

- `"insecure"` - No authentication required (use only for development)
- `"loggedIn"` - Requires authenticated user
- CEL expression - Custom authorization logic

### clients

OAuth client names that can use this IdP:

```typescript
defineIdp("my-idp", {
  clients: ["default-client", "mobile-client"],
});
```

## Using idp.provider()

The `idp.provider()` method creates a type-safe reference to the IdP for use in Auth configuration. The client name is validated at compile time against the clients defined in the IdP.

```typescript
import { defineIdp, defineAuth, defineConfig } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

const idp = defineIdp("my-idp", {
  authorization: "loggedIn",
  clients: ["default-client", "mobile-client"],
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
