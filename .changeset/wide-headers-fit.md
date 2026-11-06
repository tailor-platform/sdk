---
"@tailor-platform/sdk": patch
---

Type `args.headers` of an incoming-webhook executor as `Record<string, string | string[]>` when `incomingWebhookTrigger` has no type argument, and widen the `IncomingWebhookRequest` constraint the same way, so the type matches the values the Platform delivers: a header sent on more than one line arrives as an array. Behavior is unchanged. Code that passes a header to a parameter typed `string` now fails type checking; narrow it with `Array.isArray` first, or give `incomingWebhookTrigger` a type argument such as `{ body: Record<string, unknown>; headers: Record<string, string> }`, which still type-checks.
