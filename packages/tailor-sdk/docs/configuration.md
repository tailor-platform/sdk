# Configuration

The SDK uses TypeScript for configuration files. By default, it uses `tailor.config.ts` in the project root. You can specify a different path using the `--config` option.

### Application Settings

```typescript
export default defineConfig({
  name: "my-app",
  cors: ["https://example.com", website.url],
  allowedIPAddresses: ["192.168.1.0/24"],
  disableIntrospection: false,
});
```

**Name**: Set the application name.

**CORS**: Specify CORS settings as an array.

**Allowed IP Addresses**: Specify IP addresses allowed to access the application in CIDR format.

**Disable Introspection**: Disable GraphQL introspection. Default is `false`.

### Service Configuration

Specify glob patterns to load service files:

```typescript
export default defineConfig({
  db: {
    "my-db": {
      files: ["db/**/*.ts"],
      ignores: ["db/**/*.draft.ts"],
    },
  },
  resolver: {
    "my-resolver": {
      files: ["resolver/**/*.ts"],
    },
  },
  executor: {
    files: ["executors/**/*.ts"],
  },
});
```

**files**: Glob patterns to match files. Required.

**ignores**: Glob patterns to exclude files. Optional. By default, `**/*.test.ts` and `**/*.spec.ts` are automatically ignored. If you explicitly specify `ignores`, the default patterns will not be applied. Use `ignores: []` to include all files including test files.

### Built-in IdP

Configure the Built-in IdP service using `defineIdp()`. The returned IdP object provides type-safe provider references via `idp.provider()` that can be used in Auth service configuration.

```typescript
import { defineIdp } from "@tailor-platform/tailor-sdk";

const idp = defineIdp("my-idp", {
  authorization: "loggedIn",
  clients: ["my-client"],
});

export default defineConfig({
  idp: [idp],
});
```

**authorization**: User management permissions (`"insecure"`, `"loggedIn"`, or CEL expression).

**clients**: OAuth client names for the IdP.

### Auth Service

Configure Auth service using `defineAuth()`:

```typescript
import { defineAuth } from "@tailor-platform/tailor-sdk";
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

**userProfile**: Maps identities to TailorDB type with username field and attributes.

**machineUsers**: Service accounts with predefined attributes.

**oauth2Clients**: OAuth 2.0 clients with redirect URIs and grant types.

**idProvider**: External identity provider (OIDC, SAML, IDToken, or BuiltInIdP).

### Static Websites

Configure static website hosting using `defineStaticWebSite()`. The returned website object provides a type-safe `url` property that can be used in CORS settings and OAuth2 redirect URIs.

```typescript
import { defineStaticWebSite } from "@tailor-platform/tailor-sdk";

const website = defineStaticWebSite("my-website", {
  description: "My Static Website",
  allowedIPAddresses: ["192.168.0.0/24"],
});

export default defineConfig({
  staticWebsites: [website],
});
```

**description**: Description of the site.

**allowedIPAddresses**: List of IP addresses allowed to access the site in CIDR format.
