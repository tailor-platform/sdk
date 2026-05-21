---
"@tailor-platform/sdk": patch
---

Eliminate the Node.js `DEP0205` `DeprecationWarning` (`` `module.register()` is deprecated. Use `module.registerHooks()` instead. ``) printed by every `tailor-sdk` CLI invocation on Node v26. The CLI now registers `tsx` through its own programmatic API (`tsx/esm/api`) instead of calling `node:module`'s `register("tsx", …)` directly, which on tsx 4.21.1+ routes through `module.registerHooks()` on Node ≥ 24.11.1 / 25.1 / 26 and falls back to `module.register()` on older runtimes. Bumps the bundled `tsx` from 4.21.0 to 4.21.1.
