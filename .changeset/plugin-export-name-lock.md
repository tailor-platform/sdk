---
"@tailor-platform/sdk": major
"@tailor-platform/sdk-codemod": patch
---

Lock the plugin config export name to `plugins`. `definePlugins()` must be assigned to `export const plugins` in `tailor.config.ts`; any other export name (`plugins2`, `generator`, `generators`, etc.) is no longer read for plugins, matching the documented convention. A `plugins` export that is not an array, or that contains an item that is not a valid plugin, now fails config loading with a descriptive error instead of being silently dropped. A duplicate plugin ID within `plugins` now fails config loading in every code path instead of silently keeping only the last one.

Provide a v3 upgrade codemod for existing `generator`/`generators` exports. Preserve unrelated imports and shadowed variables, and leave imports unchanged when their config cannot be safely renamed.
