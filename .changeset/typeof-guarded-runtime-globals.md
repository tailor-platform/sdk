---
"@tailor-platform/sdk": patch
---

Deploying a resolver, executor, or workflow no longer fails with `FORBIDDEN_RUNTIME_GLOBAL` for a Node-only global such as `process` that is only used after checking that it exists — for example `if (typeof process !== "undefined") { ... process.env.FOO ... }`, an early exit such as `if (typeof process === "undefined") return;` followed by `process.env.FOO`, or `typeof process < "u" && process.emitWarning(message)`. A global used without such a check is still reported — for example the `Buffer.from(...)` inside `@ai-sdk/gateway`, which the Vercel AI SDK (`ai`) depends on.
