---
"@tailor-platform/sdk": minor
---

Add `PluginFieldExtensions`, a new interface exported from `@tailor-platform/sdk` alongside `PluginConfigs`. A TailorDB plugin author declares it via the same `declare module "@tailor-platform/sdk"` declaration merging used for `PluginConfigs` (see the plugin docs), keyed by the plugin's `id`, to make the fields it injects at generation time show up on the attached table's own static type immediately — computed from the literal per-table config passed to `.plugin()`, without a separate hand-written declaration. `Plugin` gains an optional third type parameter so `onTableLoaded`'s `extends.fields` return type can be checked against the declared field extension. `.plugin()` now reports a type error at the call site when an injected field name collides with an existing field or with a field injected by another plugin attached in the same call — including previously-unregistered plugin ids passed to `.plugin()`, which used to be silently accepted.
