---
"@tailor-platform/sdk": minor
---

Expose `invoker` on resolver/executor/workflow body contexts. The SDK now calls `tailor.context.getInvoker()` inside bundled wrappers and passes the result to user code as `context.invoker` / `args.invoker`. This reflects `authInvoker` delegation (machine user when specified) and is `null` for anonymous callers.
