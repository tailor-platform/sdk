---
"@tailor-platform/sdk": patch
---

Guarantee that importing the SDK never loads zod in user projects — neither zod runtime code in bundled functions nor zod type computation in tsc. Internal type definitions are reorganized into per-layer pure type modules, and new CI checks verify every user-facing entry point stays zod-free at both the type and runtime level and that the internal module graph has no import cycles.
