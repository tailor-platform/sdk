---
"@tailor-platform/sdk": patch
---

Fix `deploy`/`generate` failing to bundle any resolver, executor, workflow job, auth hook, or HTTP adapter with "Could not resolve `node:async_hooks`". A workflow job's test-only invoker propagation is unreachable code once bundled for the Tailor Platform runtime, but still needed resolving before this fix.
