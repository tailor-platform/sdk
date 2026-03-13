# Executor Trigger Reference

## Record triggers

All record triggers accept `{ type, condition? }`.

### recordCreatedTrigger

```typescript
import { recordCreatedTrigger } from "@tailor-platform/sdk";

recordCreatedTrigger({
  type: myType,
  condition: ({ workspaceId, appNamespace, env, actor, typeName, newRecord }) => {
    return newRecord.status === "active";
  },
});
```

### recordUpdatedTrigger

```typescript
import { recordUpdatedTrigger } from "@tailor-platform/sdk";

recordUpdatedTrigger({
  type: myType,
  condition: ({ newRecord, oldRecord }) => {
    return newRecord.status !== oldRecord.status;
  },
});
```

### recordDeletedTrigger

```typescript
import { recordDeletedTrigger } from "@tailor-platform/sdk";

recordDeletedTrigger({
  type: myType,
  condition: ({ oldRecord }) => {
    return oldRecord.important === true;
  },
});
```

## Resolver trigger

```typescript
import { resolverExecutedTrigger } from "@tailor-platform/sdk";
import myResolver from "../resolvers/myResolver";

resolverExecutedTrigger({
  resolver: myResolver,
  condition: (args) => {
    // Discriminated union on success field
    if (args.success) {
      return args.result.amount > 1000;
    }
    return false;
  },
});
```

Args: `{ workspaceId, appNamespace, env, actor, resolverName, success, result?, error? }`

## Schedule trigger

```typescript
import { scheduleTrigger } from "@tailor-platform/sdk";

scheduleTrigger({
  cron: "0 12 * * *", // Standard 5-field cron
  timezone: "Asia/Tokyo", // IANA timezone
});
```

Args to operation: `{ env }`

## Webhook trigger

```typescript
import { incomingWebhookTrigger } from "@tailor-platform/sdk";

incomingWebhookTrigger<{
  body: { type: string; data: unknown };
  headers: { "x-signature": string };
}>();
```

Args: `{ body, headers, method, rawBody, env }`

## IdP user triggers

```typescript
import {
  idpUserCreatedTrigger,
  idpUserUpdatedTrigger,
  idpUserDeletedTrigger,
} from "@tailor-platform/sdk";

idpUserCreatedTrigger();
idpUserUpdatedTrigger();
idpUserDeletedTrigger();
```

Args: `{ workspaceId, appNamespace, env, actor, namespaceName, userId }`

## Auth token triggers

```typescript
import {
  authAccessTokenIssuedTrigger,
  authAccessTokenRefreshedTrigger,
  authAccessTokenRevokedTrigger,
} from "@tailor-platform/sdk";

authAccessTokenIssuedTrigger();
authAccessTokenRefreshedTrigger();
authAccessTokenRevokedTrigger();
```

Args: `{ workspaceId, appNamespace, env, actor, namespaceName, userId }`

## Operation types

| Kind         | Purpose                | Notes                           |
| ------------ | ---------------------- | ------------------------------- |
| `"function"` | TypeScript execution   | Must return void                |
| `"graphql"`  | GraphQL mutation/query | Requires authInvoker            |
| `"webhook"`  | HTTP call              | Supports secret refs in headers |
| `"workflow"` | Trigger workflow       | Requires authInvoker            |
