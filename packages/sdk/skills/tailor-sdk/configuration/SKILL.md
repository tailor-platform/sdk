---
name: tailor-sdk/configuration
description: >
  Define tailor.config.ts with defineConfig, defineAuth, defineIdp,
  defineStaticWebSite, definePlugins. Covers auth with userProfile,
  machineUsers, oauth2Clients, IdP authorization (loggedIn, insecure,
  CEL), CORS with deployment-time website.url, environment variables,
  service glob patterns, external resource references for multi-app
  DB sharing.
type: sub-skill
library: tailor-sdk
library_version: "1.25.1"
sources:
  - "tailor-platform/sdk:packages/sdk/docs/configuration.md"
  - "tailor-platform/sdk:packages/sdk/docs/services/auth.md"
  - "tailor-platform/sdk:packages/sdk/docs/services/idp.md"
  - "tailor-platform/sdk:packages/sdk/docs/services/staticwebsite.md"
  - "tailor-platform/sdk:packages/sdk/src/configure/config.ts"
---

This skill builds on tailor-sdk. Read tailor-sdk/SKILL.md first for an overview.

# Configuration

## Setup

Minimal `tailor.config.ts`:

```typescript
import { defineConfig, defineAuth, defineIdp, definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

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
  machineUsers: {
    "admin-machine-user": {
      attributes: { role: "ADMIN" },
    },
  },
  oauth2Clients: {
    "my-client": {
      redirectURIs: ["http://localhost:3000/callback"],
      grantTypes: ["authorization_code", "refresh_token"],
    },
  },
  idProvider: idp.provider("my-provider", "default-client"),
});

export const plugins = definePlugins(kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }));

export default defineConfig({
  name: "my-app",
  env: { appName: "My App" },
  cors: [website.url],
  db: {
    tailordb: { files: ["./tailordb/*.ts"] },
  },
  resolver: { "my-resolver": { files: ["./resolvers/*.ts"] } },
  executor: { files: ["./executors/*.ts"] },
  workflow: { files: ["./workflows/**/*.ts"] },
  idp: [idp],
  auth,
  staticWebsites: [website],
});
```

## Core Patterns

### Static website with deployment-time URL

```typescript
import { defineStaticWebSite } from "@tailor-platform/sdk";

const website = defineStaticWebSite("frontend", {
  description: "Frontend application",
});

// website.url resolves at deployment time — use it in CORS and OAuth redirects
export default defineConfig({
  cors: [website.url],
  staticWebsites: [website],
});
```

### External resource references for multi-app DB sharing

When multiple apps share the same database, one app owns the DB definition and others reference it as external:

```typescript
// App B — references App A's DB (does not define types)
export default defineConfig({
  name: "customer-portal",
  db: {
    tailordb: { external: true },
  },
  resolver: { "portal-resolver": { files: ["./resolvers/*.ts"] } },
});
```

### Environment variables

```typescript
export default defineConfig({
  env: { apiUrl: "https://api.example.com", maxRetries: 3 },
});

// Accessible in resolvers, executors, workflows via context.env
createResolver({
  body: ({ env }) => {
    return env.apiUrl;
  },
});
```

### Plugin configuration

```typescript
import { definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { enumConstantsPlugin } from "@tailor-platform/sdk/plugin/enum-constants";
import { fileUtilsPlugin } from "@tailor-platform/sdk/plugin/file-utils";
import { seedPlugin } from "@tailor-platform/sdk/plugin/seed";

export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }),
  enumConstantsPlugin({ distPath: "./generated/enums.ts" }),
  fileUtilsPlugin({ distPath: "./generated/files.ts" }),
  seedPlugin({ distPath: "./seed", machineUserName: "admin-machine-user" }),
);
```

## Common Mistakes

### HIGH Using deprecated defineGenerators instead of definePlugins

Wrong:

```typescript
import { defineGenerators } from "@tailor-platform/sdk";
export const generators = defineGenerators([
  "@tailor-platform/kysely-type",
  { distPath: "./generated/tailordb.ts" },
]);
```

Correct:

```typescript
import { definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
export const plugins = definePlugins(kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }));
```

defineGenerators is deprecated. It still works but agents should use the plugin API.

Source: packages/sdk/src/configure/config.ts

### CRITICAL Providing both userProfile and machineUserAttributes

Wrong:

```typescript
defineAuth("auth", {
  userProfile: { type: user, usernameField: "email" },
  machineUserAttributes: { role: t.string() },
});
```

Correct:

```typescript
defineAuth("auth", {
  userProfile: { type: user, usernameField: "email", attributes: { role: true } },
  machineUsers: { admin: { attributes: { role: "ADMIN" } } },
});
```

defineAuth throws at runtime if both userProfile and machineUserAttributes are provided. Use userProfile when you have a user type; use machineUserAttributes only when there are no human users.

Source: packages/sdk/src/configure/services/auth/index.ts

### CRITICAL Missing unique constraint on usernameField

Wrong:

```typescript
const user = db.type("User", {
  email: db.string(),
});
defineAuth("auth", {
  userProfile: { type: user, usernameField: "email" },
});
```

Correct:

```typescript
const user = db.type("User", {
  email: db.string().unique(),
});
defineAuth("auth", {
  userProfile: { type: user, usernameField: "email" },
});
```

The usernameField must have .unique() on the TailorDB type. Without it, auth fails at runtime with duplicate user errors.

Source: docs/services/auth.md

### HIGH Hardcoding static website URL in CORS

Wrong:

```typescript
export default defineConfig({
  cors: ["https://my-app.tailor.tech"],
});
```

Correct:

```typescript
const website = defineStaticWebSite("frontend", {});
export default defineConfig({
  cors: [website.url],
  staticWebsites: [website],
});
```

Static website URLs are resolved at deployment time. Hardcoded URLs break CORS when the deployment URL changes.

Source: docs/services/staticwebsite.md

### CRITICAL Using insecure IdP authorization in production

Wrong:

```typescript
defineIdp("my-idp", {
  authorization: "insecure",
});
```

Correct:

```typescript
defineIdp("my-idp", {
  authorization: "loggedIn",
});
```

"insecure" allows unauthenticated access — development only. Use "loggedIn" or a CEL expression for production.

Source: docs/services/idp.md

### HIGH Tension: Declarative config vs imperative logic

Configuration (defineConfig, defineAuth) is declarative and validated at build time. Resolvers and executors contain imperative TypeScript validated at runtime. Agents mixing config-level concerns (auth, permissions) with runtime logic produce code that type-checks but fails at deployment.

See also: tailor-sdk/resolver/SKILL.md § Common Mistakes
See also: tailor-sdk/executor/SKILL.md § Common Mistakes

See also: tailor-sdk/model-definition/SKILL.md — auth.userProfile references a TailorDB type
See also: tailor-sdk/cli-operations/SKILL.md — config defines what CLI deploys
