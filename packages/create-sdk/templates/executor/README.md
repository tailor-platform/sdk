# Executor Template

Demonstrates executor triggers with supporting infrastructure.

## Trigger Types

- `recordCreatedTrigger` - React to new record creation (with condition)
- `recordUpdatedTrigger` - React to record updates
- `recordDeletedTrigger` - React to record deletion
- `resolverExecutedTrigger` - React to resolver execution
- `scheduleTrigger` - CRON-based scheduled execution
- `incomingWebhookTrigger` - React to external webhook calls
- `idpUserCreatedTrigger` / `idpUserUpdatedTrigger` / `idpUserDeletedTrigger` - React to IdP user changes
- `authAccessTokenIssuedTrigger` / `authAccessTokenRefreshedTrigger` / `authAccessTokenRevokedTrigger` - React to auth access token events

## Operation Kinds

- `function` - Custom function body
- `workflow` - Trigger a workflow

## Getting Started

```bash
pnpm install
pnpm generate
pnpm deploy
```

## Testing

```bash
pnpm test
```
