---
"@tailor-platform/sdk": minor
---

Rename the `apply` CLI command to `deploy`. `tailor-sdk deploy` is the canonical
command name; `tailor-sdk apply` continues to work as an alias for backward
compatibility on the command line.

The programmatic API exported from `@tailor-platform/sdk/cli` is also available
under the new name. `deploy` / `DeployOptions` are now the canonical exports,
while `apply` / `ApplyOptions` continue to be re-exported as aliases so existing
imports keep working:

- `import { apply } from "@tailor-platform/sdk/cli"` — still works (alias for `deploy`)
- `import type { ApplyOptions } from "@tailor-platform/sdk/cli"` — still works (alias for `DeployOptions`)

Migration is optional but recommended:

- `apply` → `deploy`
- `ApplyOptions` → `DeployOptions`
