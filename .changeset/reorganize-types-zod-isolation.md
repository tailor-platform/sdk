---
"@tailor-platform/sdk": patch
---

Guarantee that importing the SDK never loads zod in user projects — neither zod runtime code in bundled functions nor zod type computation in tsc. Internal type definitions are reorganized into per-layer pure type modules, and a new CI check verifies every user-facing entry point stays zod-free at both the type and runtime level.
