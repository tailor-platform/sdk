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

There are two ways to manage secrets: declaratively via `defineSecretManager()` in `tailor.config.ts`, or imperatively via the [CLI](#cli-management). Management is scoped per vault — **do not mix both approaches for the same vault**. When a vault is defined in config, the config becomes the source of truth: any secrets in that vault not present in the config will be deleted on `tailor-sdk apply`.

### Declarative Configuration

Define your secrets in `tailor.config.ts` using `defineSecretManager()`. Each key is a vault name, and its value is a record of secret names to their values. These values are deployed to each vault on `tailor-sdk apply`.

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

The exported `secrets` object provides type-safe `get()` and `getAll()` methods for runtime access from resolvers, executors, and workflows.

### Skipping Secrets with Missing Values

In CI environments, you may not have all secret values available (e.g., secrets are already set on the platform and you don't want to duplicate them in CI environment variables). Use the `skipNullishValues` option to skip secrets whose values are `undefined` or `null`:

```typescript
export const secrets = defineSecretManager(
  {
    "api-keys": {
      "stripe-secret-key": process.env.STRIPE_SECRET_KEY,
      "sendgrid-api-key": process.env.SENDGRID_API_KEY,
    },
  },
  { skipNullishValues: true },
);
```

When `skipNullishValues: true`:

- Secrets with a string value are created or updated as normal
- Secrets with `undefined` or `null` values are **skipped** — they are not created, updated, or deleted
- Skipped secrets are shown in the deploy output for visibility
- Secrets removed from the config entirely are still deleted (orphan cleanup)

This allows you to set secret values once (e.g., via local `tailor-sdk apply` or the CLI) and then deploy from CI without needing the actual values in CI environment variables.

## Using Secrets

### Runtime Access with `get()` / `getAll()`

Use the `secrets` object exported from `tailor.config.ts` to retrieve secret values at runtime. The vault and secret names are fully type-checked based on the `defineSecretManager()` configuration.

#### `get(vault, secret)`

Retrieves a single secret value.

```typescript
import { createResolver } from "@tailor-platform/sdk";
import { secrets } from "../tailor.config";

export default createResolver({
  name: "call-stripe",
  // ...
  operation: async ({ input }) => {
    const apiKey = await secrets.get("api-keys", "stripe-secret-key");
    // Use apiKey to call the Stripe API
  },
});
```

#### `getAll(vault, secrets)`

Retrieves multiple secret values at once from the same vault.

```typescript
import { createResolver } from "@tailor-platform/sdk";
import { secrets } from "../tailor.config";

export default createResolver({
  name: "send-notification",
  // ...
  operation: async ({ input }) => {
    const [apiKey, webhookSecret] = await secrets.getAll("api-keys", [
      "sendgrid-api-key",
      "stripe-secret-key",
    ]);
    // Use the retrieved secrets
  },
});
```

Both methods return `Promise<string | undefined>` (or an array of them for `getAll`).

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

After ownership is released, the next `tailor-sdk apply` will treat the vault as an unmanaged resource and prompt for confirmation before taking any action on it.

### Create a Vault

```bash
tailor-sdk secret vault create --name api-keys
```

### Add Secrets

```bash
# Create a secret
tailor-sdk secret create \
  --vault-name api-keys \
  --name stripe-secret-key \
  --value sk_live_xxxxx

# Update a secret
tailor-sdk secret update \
  --vault-name api-keys \
  --name stripe-secret-key \
  --value sk_live_yyyyy
```

### List Secrets

```bash
# List vaults
tailor-sdk secret vault list

# List secrets in a vault (values are hidden)
tailor-sdk secret list --vault-name api-keys
```

### Delete Secrets

```bash
# Delete a secret
tailor-sdk secret delete --vault-name api-keys --name old-key --yes

# Delete a vault (must be empty)
tailor-sdk secret vault delete --name old-vault --yes
```

See [Secret CLI Commands](../cli/secret.md) for full documentation.
