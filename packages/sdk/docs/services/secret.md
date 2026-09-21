# Secret Manager

Secret Manager provides secure storage for sensitive values like API keys, tokens, and credentials that your application needs at runtime.

## Overview

Secret Manager provides:

- Secure storage for sensitive configuration values
- Organized secrets within named vaults
- Runtime access from executors and workflows
- CLI management for secrets lifecycle

## Concepts

### Vaults

Vaults are containers that group related secrets together. Each workspace can have multiple vaults, typically organized by purpose or environment.

```
workspace/
├── vault: api-keys
│   ├── stripe-secret-key
│   ├── sendgrid-api-key
│   └── external-service-token
└── vault: database
    ├── read-replica-password
    └── analytics-connection-string
```

### Secrets

Secrets are key-value pairs stored within a vault. Secret values are encrypted at rest and only accessible at runtime by authorized services.

## Managing Secrets

There are two ways to manage secrets: declaratively via `defineSecretManager()` in `tailor.config.ts`, or imperatively via the [CLI](#cli-management). Management is scoped per vault — **do not mix both approaches for the same vault**. When a vault is defined in config, the config becomes the source of truth: any secrets in that vault not present in the config will be deleted on `tailor deploy`.

### Declarative Configuration

Define your secrets in `tailor.config.ts` using `defineSecretManager()`. Each key is a vault name, and its value is a record of secret names to their values. These values are deployed to each vault on `tailor deploy`.

Since secret values should not be committed to source control, use environment variables:

```typescript
import { defineConfig, defineSecretManager } from "@tailor-platform/sdk";

export const secrets = defineSecretManager({
  "api-keys": {
    "stripe-secret-key": process.env.STRIPE_SECRET_KEY!,
    "sendgrid-api-key": process.env.SENDGRID_API_KEY!,
  },
  database: {
    "analytics-connection-string": process.env.ANALYTICS_DB_URL!,
  },
});

export default defineConfig({
  name: "my-app",
  secrets,
  // ...other config
});
```

The exported `secrets` object also carries the values you passed in, so import it only from `tailor.config.ts` itself — never from a resolver, executor, or workflow file. To read a secret at runtime, use the `secretmanager` API described below instead. Its `get()`/`getAll()` methods are deprecated for the same reason and will be removed in a future major version.

### Skipping Secrets with Missing Values

In CI environments, you may not have all secret values available (e.g., secrets are already set on the platform and you don't want to duplicate them in CI environment variables). Use the `ignoreNullishValues` option to skip secrets whose values are `undefined` or `null`:

```typescript
export const secrets = defineSecretManager(
  {
    "api-keys": {
      "stripe-secret-key": process.env.STRIPE_SECRET_KEY,
      "sendgrid-api-key": process.env.SENDGRID_API_KEY,
    },
  },
  { ignoreNullishValues: true },
);
```

When `ignoreNullishValues: true`:

- Secrets with a string value are created or updated as normal
- Secrets with `undefined` or `null` values are **skipped** — they are not created, updated, or deleted
- Skipped secrets are shown in the deploy output for visibility
- Secrets removed from the config entirely are still deleted (orphan cleanup)

This allows you to set secret values once (e.g., via local `tailor deploy` or the CLI) and then deploy from CI without needing the actual values in CI environment variables.

## Using Secrets

### Runtime Access with `secretmanager`

Read secret values at runtime with the `secretmanager` API from `@tailor-platform/sdk/runtime`, the same module you use for other platform runtime APIs (`idp`, `workflow`, `authconnection`, etc.). Pass the vault and secret names as plain strings — they are not type-checked against `defineSecretManager()`, since this API works independently of your `tailor.config.ts` exports.

#### `getSecret(vault, name)`

Retrieves a single secret value.

```typescript
import { createResolver } from "@tailor-platform/sdk";
import { secretmanager } from "@tailor-platform/sdk/runtime";

export default createResolver({
  name: "call-stripe",
  operation: "query",
  // ...
  body: async ({ input }) => {
    const apiKey = await secretmanager.getSecret("api-keys", "stripe-secret-key");
    // Use apiKey to call the Stripe API
  },
});
```

#### `getSecrets(vault, names)`

Retrieves multiple secret values at once from the same vault.

```typescript
import { createResolver } from "@tailor-platform/sdk";
import { secretmanager } from "@tailor-platform/sdk/runtime";

export default createResolver({
  name: "send-notification",
  operation: "query",
  // ...
  body: async ({ input }) => {
    const { "sendgrid-api-key": apiKey, "stripe-secret-key": webhookSecret } =
      await secretmanager.getSecrets("api-keys", ["sendgrid-api-key", "stripe-secret-key"]);
    // Use the retrieved secrets
  },
});
```

`getSecret` returns `Promise<string | undefined>`; `getSecrets` returns a `Promise` of a partial record keyed by the requested names, omitting any name that has no value.

Import `secretmanager` directly in resolver, executor, and workflow files — never the `secrets` object from `tailor.config.ts` (see [Declarative Configuration](#declarative-configuration) above).

### In Webhook Operations

Reference secrets in webhook headers using the vault/key syntax:

```typescript
import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { order } from "../tailordb/order";

export default createExecutor({
  name: "notify-external-service",
  trigger: recordCreatedTrigger({ type: order }),
  operation: {
    kind: "webhook",
    url: "https://api.example.com/orders",
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "api-keys", key: "external-api-token" },
      "X-API-Key": { vault: "api-keys", key: "api-secret" },
    },
    requestBody: ({ newRecord }) => ({
      orderId: newRecord.id,
      amount: newRecord.total,
    }),
  },
});
```

The secret reference format:

```typescript
{ vault: "vault-name", key: "secret-name" }
```

At runtime, these references are replaced with the actual secret values.

## CLI Management

Use the CLI to manage vaults that are **not** defined in `defineSecretManager()`. If you attempt to modify a vault that is managed by the config, the CLI will show a warning and ask for confirmation. Once confirmed, the CLI releases the vault's ownership label so it is no longer managed by config.

After ownership is released, the next `tailor deploy` will treat the vault as an unmanaged resource and prompt for confirmation before taking any action on it.

### Create a Vault

```bash
tailor secret vault create --name api-keys
```

### Add Secrets

```bash
# Create a secret
tailor secret create \
  --vault-name api-keys \
  --name stripe-secret-key \
  --value sk_live_xxxxx

# Update a secret
tailor secret update \
  --vault-name api-keys \
  --name stripe-secret-key \
  --value sk_live_yyyyy
```

### List Secrets

```bash
# List vaults
tailor secret vault list

# List secrets in a vault (values are hidden)
tailor secret list --vault-name api-keys
```

### Delete Secrets

```bash
# Delete a secret
tailor secret delete --vault-name api-keys --name old-key --yes

# Delete a vault (must be empty)
tailor secret vault delete --name old-vault --yes
```

See [Secret CLI Commands](../cli/secret.md) for full documentation.
