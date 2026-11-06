---
"@tailor-platform/create-sdk": patch
---

The executor template's `external-webhook` executor now verifies an HMAC-SHA256 signature over the request body before processing it. Until the `signing-secret` secret exists in the `webhook` vault, and for any request whose `x-webhook-signature` header is not the HMAC-SHA256 of the body keyed with that secret, the executor job fails without logging the payload, while the webhook URL still responds with success; `tailor executor jobs external-webhook` lists the failed jobs. The template README shows how to create the secret and send a signed request. Projects scaffolded earlier keep their existing `externalWebhook.ts`; to protect them the same way, verify the signature over the base64-decoded `rawBody` before using `body`.
