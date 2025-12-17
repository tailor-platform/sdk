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

## Using Secrets

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
