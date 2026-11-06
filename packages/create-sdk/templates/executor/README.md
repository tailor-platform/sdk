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

## Webhook Signature

The incoming webhook URL is public, so `src/executor/externalWebhook.ts` processes a request only when its `x-webhook-signature` header holds the hex HMAC-SHA256 of the request body, keyed with the `signing-secret` secret in the `webhook` vault. The executor receives the body as `rawBody`, base64-encoded, and decodes it before verifying.

Every request fails until the secret exists. Create it after deploying, and give the value to the webhook sender:

```bash
WEBHOOK_SIGNING_SECRET=$(openssl rand -hex 32)
pnpm tailor secret vault create --name webhook
printf '%s' "$WEBHOOK_SIGNING_SECRET" | pnpm tailor secret create --vault-name webhook --name signing-secret
```

Send a signed request:

```bash
WEBHOOK_URL=$(pnpm tailor executor webhook list --json | jq -r '.[] | select(.name == "external-webhook") | .webhookUrl')
BODY='{"event":"order.created","payload":{"orderId":"order-1"}}'
SIGNATURE=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SIGNING_SECRET" | sed 's/.*= //')
curl -X POST "$WEBHOOK_URL" -H "Content-Type: application/json" -H "x-webhook-signature: $SIGNATURE" -d "$BODY"
```

The URL responds with success even when the executor rejects the request. A rejected request leaves a `FAILED` job in `pnpm tailor executor jobs external-webhook`, and `pnpm tailor executor jobs external-webhook <job-id> --attempts` shows the error. `pnpm tailor executor trigger external-webhook` without `-H` sends no signature, so its job fails too.

## Testing

```bash
pnpm test
```
