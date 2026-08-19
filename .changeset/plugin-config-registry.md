---
"@tailor-platform/sdk": minor
---

Add `PluginConfigRegistry` to `@tailor-platform/sdk/plugin`, an interface builtin plugins extend via declaration merging to register their config type under their own id. `kyselyTypePlugin` and `seedPlugin` now register through it.
