---
"@tailor-platform/sdk": patch
---

The Stripe example in the incoming webhook docs now shows where to verify the `stripe-signature` header against `rawBody`, and links to Stripe's verification steps. The docs and the `rawBody` type of `IncomingWebhookArgs` now say that `rawBody` is delivered base64-encoded and has to be decoded to the original bytes before computing a signature.
