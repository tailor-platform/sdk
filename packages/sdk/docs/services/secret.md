---
description: "Store API keys, tokens, and other credentials in Secret Manager vaults, and read them at runtime from executors and workflows."
---

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

### Reserved Vault Names

Vault names that start with `tailor--` (two hyphens) are reserved in advance for the platform and have no use today. Declaring such a vault in `defineSecretManager()` prints a warning on `tailor deploy` and will become an error in v3. A name that starts with a single `tailor-`, such as `tailor-reports`, is not reserved.

`tailor deploy` also creates a vault named `idp-<namespace>-<client>` for each IdP client of your application. A declared vault with exactly that name is an error, because both would write to the same vault.

### Secrets

Secrets are key-value pairs stored within a vault. Secret values are encrypted at rest and only accessible at runtime by authorized services.

## Managing Secrets

There are two ways to manage secrets: declaratively via `defineSecretManager()` in `tailor.config.ts`, or imperatively via the [CLI](#cli-management). Management is scoped per vault — **do not mix both approaches for the same vault**. When a vault is defined in config, the config becomes the source of truth: any secrets in that vault not present in the config will be deleted on `tailor deploy`.

### Declarative Configuration

Define your secrets in `tailor.config.ts` using `defineSecretManager()`. Each key is a vault name, and its value is a record of secret names to their values. These values are deployed to each vault on `tailor deploy`, except that a secret declared as `{ create: value }` keeps the value it already has (see [Creating a Secret Only Once](#creating-a-secret-only-once)).

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

The exported `secrets` object also carries the values you passed in, so import it only where you build your `tailor.config.ts` config (the file itself, or a helper module you import into it) — never from a resolver, executor, or workflow file. This `secrets` object's `get()`/`getAll()` methods are deprecated for the same reason and will be removed in a future major version; to read a secret at runtime, use the `secretmanager` API described below instead.

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

### Creating a Secret Only Once

Some secrets, such as an encryption key, must be generated once per environment and then keep their value. Declare them as `{ create: value }`:

```typescript
import { randomBytes } from "node:crypto";

export const secrets = defineSecretManager({
  "app-keys": {
    "encryption-key-v1": { create: randomBytes(32).toString("hex") },
    "api-key": process.env.API_KEY!, // written on every deploy
  },
});
```

On `tailor deploy`:

- If the secret does not exist, it is created with `value`, and its vault is created too if needed.
- If the secret already exists, it is left as it is, even when `value` differs from the stored value.
- If two deploys create the same secret at the same time, the secret keeps the value of the deploy that created it first.
- A `null` or `undefined` `value` follows the same rule as a string value: an error, or skipped with `ignoreNullishValues: true`.

Removing the secret or its vault from the config still deletes it on the next deploy, and the old value cannot be recovered, so data encrypted with that key can no longer be decrypted. The SDK does not keep a record that it created the secret: if the secret is deleted, the next deploy creates it again with a new value. Have your application detect a key it cannot use rather than relying on deploy to notice.

To replace the value with a new one, do one of the following:

- Rename the secret, for example from `encryption-key-v1` to `encryption-key-v2`, and deploy.
- Remove the secret from the config and deploy, then add it back and deploy again.
- Delete the secret with [`tailor secret delete`](#delete-secrets) and deploy. Because the delete releases the vault from the config, the deploy asks for confirmation before managing the vault again.

## Using Secrets

### Runtime Access with `secretmanager`

Read secret values at runtime with the `secretmanager` API from `@tailor-platform/sdk/runtime`, the same module you use for other platform runtime APIs (`idp`, `workflow`, `authconnection`, etc.). Pass the vault and secret names as strings. Once `tailor generate`/`tailor deploy` has run, vault names are autocompleted from `defineSecretManager()` (any other string still works, since vaults can also be managed imperatively via the CLI — see [Managing Secrets](#managing-secrets)), and inside a declared vault, secret names are checked against that vault's configuration.

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

    // await secretmanager.getSecret("api-keys", "unknown-key"); // Type error — "api-keys" only has "stripe-secret-key" and "sendgrid-api-key"
    // await secretmanager.getSecret("cli-managed-vault", "anything"); // Fine — "cli-managed-vault" isn't declared in defineSecretManager(), so its secret names aren't checked
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

`getSecret` returns `Promise<string | undefined>`, resolving to `undefined` when the vault has no such secret; `getSecrets` returns a `Promise` of a partial record keyed by the requested names, omitting any name that has no value. Both reject with an error containing `vault not found: <vault>` when the vault does not exist; declare the vault in `defineSecretManager()` and deploy, or create it with [`tailor secret vault create`](../cli/secret.md#secret-vault-create).

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

At runtime, these references are replaced with the actual secret values. `deploy` and `remove` stop with `SERVICE_IN_USE` instead of deleting a secret, or the vault that holds it, that a webhook executor in the workspace still names this way, that an Auth service's OIDC `idProvider` or SCIM config still names, or that an [OTLP exporter](https://docs.tailor.tech/guides/opentelemetry) still authenticates with.

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

# Update a secret, reading the value from standard input
printf '%s' "$STRIPE_SECRET_KEY" | tailor secret update \
  --vault-name api-keys \
  --name stripe-secret-key
```

A value passed with `--value` can show up in your shell history and in process listings. Without `--value`, the command reads the value from standard input instead, accepting up to 128 KiB and removing one trailing newline.

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
