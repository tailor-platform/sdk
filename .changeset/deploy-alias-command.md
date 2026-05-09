---
"@tailor-platform/sdk": major
---

Rename the `apply` CLI command to `deploy`. `tailor-sdk deploy` is the canonical
command name; `tailor-sdk apply` continues to work as an alias for backward
compatibility on the command line.

The programmatic API exported from `@tailor-platform/sdk/cli` has been renamed
to match. Migrate your imports:

- `import { apply } from "@tailor-platform/sdk/cli"` → `import { deploy } from "@tailor-platform/sdk/cli"`
- `import type { ApplyOptions } from "@tailor-platform/sdk/cli"` → `import type { DeployOptions } from "@tailor-platform/sdk/cli"`

The OpenTelemetry root span name also changed from `apply` to `deploy`. Inner
spans of the apply pipeline (`apply.createUpdateServices`, `apply.cleanup`,
etc.) are unchanged.
