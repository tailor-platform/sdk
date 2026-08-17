---
"@tailor-platform/sdk": patch
---

Fix `tailor deploy` never creating TailorDB types that appear in no pending migration diff and define no GraphQL permission — for example baseline tables when a migration history is replayed into a fresh workspace. Such types are now created before any migration script runs.
