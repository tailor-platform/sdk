---
"@tailor-platform/sdk": minor
---

Add a runtime wrapper for AI Gateway. Resolvers, executors, and workflow jobs can now resolve an AI Gateway's platform-assigned URL by name via `aigateway.get(name)` (imported from `@tailor-platform/sdk/runtime`), instead of using the raw `tailor.aigateway.get(...)` global. Use `mockAigateway()` from `@tailor-platform/sdk/vitest` to mock it in unit tests.

The gateway name is type-checked and autocompleted against the AI Gateways defined via `defineAIGateway()`, once `tailor.d.ts` has been generated (via `tailor-sdk deploy`/`generate`), mirroring the existing `MachineUserNameRegistry`/`IdpNameRegistry`/`ConnectionNameRegistry` pattern.
