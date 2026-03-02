# Executor Template

Demonstrates all executor trigger types with supporting infrastructure.

## Trigger Types

- `recordCreatedTrigger` - React to new record creation (with condition)
- `recordUpdatedTrigger` - React to record updates
- `resolverExecutedTrigger` - React to resolver execution
- `scheduleTrigger` - CRON-based scheduled execution
- `incomingWebhookTrigger` - React to external webhook calls

## Operation Kinds

- `function` - Custom function body
- `graphql` - Execute GraphQL mutations
- `webhook` - Send HTTP requests
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
