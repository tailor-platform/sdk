# Static Website

Static Website is a service for hosting static web applications on the Tailor Platform.

## Overview

Static Website provides:

- Static file hosting
- Type-safe URL references for configuration
- IP address restrictions

For the official Tailor Platform documentation, see [Static Website Guide](https://docs.tailor.tech/guides/static-website-hosting).

## Configuration

Configure static website hosting using `defineStaticWebSite()`:

```typescript
import { defineStaticWebSite, defineConfig } from "@tailor-platform/sdk";

const website = defineStaticWebSite("my-website", {
  description: "My Static Website",
});

export default defineConfig({
  staticWebsites: [website],
});
```

## Options

### description

A description of the static website:

```typescript
defineStaticWebSite("my-website", {
  description: "Frontend application for my service",
});
```

### allowedIpAddresses

Restrict access to specific IP addresses in CIDR format:

```typescript
defineStaticWebSite("my-website", {
  allowedIpAddresses: ["192.168.0.0/24", "10.0.0.0/8"],
});
```

## Type-safe URL References

The returned website object provides a `url` property that resolves to the actual URL at deployment time. Use this for type-safe configuration:

### CORS Settings

```typescript
const website = defineStaticWebSite("my-frontend", {
  description: "Frontend application",
});

export default defineConfig({
  cors: [website.url], // Resolved at deployment
  staticWebsites: [website],
});
```

### OAuth2 Redirect URIs

```typescript
const website = defineStaticWebSite("my-frontend", {
  description: "Frontend application",
});

const auth = defineAuth("my-auth", {
  oauth2Clients: {
    "my-client": {
      redirectURIs: [
        `${website.url}/callback`, // https://my-frontend.example.com/callback
        `${website.url}/auth/complete`, // https://my-frontend.example.com/auth/complete
      ],
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
});
```

## Complete Example

```typescript
import {
  defineConfig,
  defineAuth,
  defineIdp,
  defineStaticWebSite,
} from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

const website = defineStaticWebSite("my-frontend", {
  description: "Frontend application",
});

const idp = defineIdp("my-idp", {
  authorization: "loggedIn",
  clients: ["default-client"],
});

const auth = defineAuth("my-auth", {
  userProfile: {
    type: user,
    usernameField: "email",
    attributes: { role: true },
  },
  oauth2Clients: {
    "frontend-client": {
      redirectURIs: [`${website.url}/callback`],
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
  idProvider: idp.provider("default", "default-client"),
});

export default defineConfig({
  name: "my-app",
  cors: [website.url],
  idp: [idp],
  auth,
  staticWebsites: [website],
});
```
