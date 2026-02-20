---
"@tailor-platform/sdk": patch
---

fix(postinstall): correct import path and call signature for generateUserTypes

- Fix import path from non-existent `dist/cli/api.mjs` to `dist/cli/lib.mjs`
- Fix function call to use options object `{ config, configPath }` instead of positional arguments
