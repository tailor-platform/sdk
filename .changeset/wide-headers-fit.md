---
"@tailor-platform/sdk": patch
---

Type the headers that RFC 9110 defines as comma-separated lists, such as `accept` and `via`, and `x-forwarded-for` as `string | string[]` in `args.headers` of an incoming-webhook executor when `incomingWebhookTrigger` has no type argument. A header sent on more than one line arrives as an array, so the type now matches the values the Platform delivers. Any other header stays a string, and `args.headers` can still be passed to a parameter typed `Record<string, string>`. The type argument of `incomingWebhookTrigger` now takes only what you want to override: `body` replaces the body type, each header named in `headers` replaces the type of that header, and everything not named keeps its default. Behavior is unchanged. Code that passes one of these list headers to a parameter typed `string` now fails type checking; narrow it with `Array.isArray` first, or name that header as `string` in the type argument.
