---
"@tailor-platform/sdk": minor
---

Add `tailor-install`, `tailor-notify`, and `tailor-drift-check` steps to generated branch/tag workflow templates. Generated workflows now pin to a SHA-addressed version of `tailor-platform/actions`.

Add `setup check --ci` flag: WORKSPACE_ID check is skipped in CI (handled by the runtime) and enforced only in local environments.

Extend lock file to support `action` and `coordinate` target kinds (stubs for `setup --action` and `setup coordinate` subcommand).
