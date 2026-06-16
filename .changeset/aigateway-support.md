---
"@tailor-platform/sdk": minor
---

Add `defineAIGateway()` for declaring AI Gateways in `tailor.config.ts`. Configure with `authNamespace` (required) and an optional `cors` allow-list; reference the deployed gateway domain via the `domain` getter. Gateways are created, updated, and removed by `tailor deploy` / `tailor remove` against the platform's AI Gateway API.
