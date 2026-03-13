---
name: tailor-sdk/quickstart
description: >
  End-to-end guide from project creation to first deployment. Covers
  create-sdk scaffolding, first tailor.config.ts, first model with
  permissions, first resolver, workspace creation, tailor-sdk apply,
  deployment verification. Use for first-time Tailor Platform setup.
type: sub-skill
library: tailor-sdk
library_version: "1.25.1"
sources:
  - "tailor-platform/sdk:packages/sdk/docs/quickstart.md"
---

This skill builds on tailor-sdk, tailor-sdk/project-setup, tailor-sdk/configuration, tailor-sdk/model-definition, and tailor-sdk/cli-operations. Read those for details on each topic.

# Quickstart

## Step 1 — Create project

```bash
node --version  # Must be v22+
npm create @tailor-platform/sdk -- --template hello-world my-app
cd my-app
pnpm install
```

## Step 2 — Define a model

Create `tailordb/user.ts`:

```typescript
import { db } from "@tailor-platform/sdk";

export const user = db
  .type("User", {
    email: db.string().unique(),
    name: db.string(),
    role: db.enum(["ADMIN", "STAFF"]),
    ...db.fields.timestamps(),
  })
  .permission({
    create: [[{ user: "role" }, "=", "ADMIN"]],
    read: [[{ user: "_loggedIn" }, "=", true]],
    update: [[{ record: "id" }, "=", { user: "id" }]],
    delete: [[{ user: "role" }, "=", "ADMIN"]],
  })
  .gqlPermission([
    {
      conditions: [[{ user: "_loggedIn" }, "=", true]],
      actions: ["read", "create"],
    },
  ]);

export type user = typeof user;
```

## Step 3 — Configure the application

Edit `tailor.config.ts`:

```typescript
import { defineConfig, defineAuth, defineIdp, definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { user } from "./tailordb/user";

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
  idProvider: idp.provider("my-provider", "default-client"),
});

export const plugins = definePlugins(kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }));

export default defineConfig({
  name: "my-app",
  db: { tailordb: { files: ["./tailordb/*.ts"] } },
  idp: [idp],
  auth,
});
```

## Step 4 — Generate types and deploy

```bash
tailor-sdk login
tailor-sdk workspace create
pnpm add -D @tailor-platform/function-types
tailor-sdk generate
tailor-sdk apply --workspace-id <workspace-id>
```

## Step 5 — Verify

```bash
tailor-sdk machineuser token admin-machine-user
# Use the token to query the deployed GraphQL API
```

## Common Mistakes

### HIGH Deploying without workspace creation

Wrong:

```bash
npm create @tailor-platform/sdk -- --template hello-world my-app
cd my-app && pnpm install
tailor-sdk apply
```

Correct:

```bash
npm create @tailor-platform/sdk -- --template hello-world my-app
cd my-app && pnpm install
tailor-sdk login
tailor-sdk workspace create
tailor-sdk apply --workspace-id <workspace-id>
```

A workspace must be created before the first deploy. The apply command needs a workspace target.

Source: docs/quickstart.md

### CRITICAL Not setting permissions on first model

Wrong:

```typescript
export const user = db.type("User", {
  email: db.string().unique(),
  name: db.string(),
});
// No .permission() or .gqlPermission() → API returns empty results
```

Correct:

```typescript
export const user = db
  .type("User", {
    email: db.string().unique(),
    name: db.string(),
  })
  .permission({
    read: [[{ user: "_loggedIn" }, "=", true]],
    create: [[{ user: "role" }, "=", "ADMIN"]],
  })
  .gqlPermission([
    {
      conditions: [[{ user: "_loggedIn" }, "=", true]],
      actions: ["read", "create"],
    },
  ]);
```

Default-deny permissions mean a deployed model with no permissions is unusable via API. This is the most common first-time issue.

Source: docs/services/tailordb.md

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

"insecure" allows unauthenticated access — development only. Always use "loggedIn" or a CEL expression for production deployments.

Source: docs/services/idp.md

See also: tailor-sdk/project-setup/SKILL.md — scaffolding details
See also: tailor-sdk/configuration/SKILL.md — full configuration reference
See also: tailor-sdk/model-definition/SKILL.md — model definition details
