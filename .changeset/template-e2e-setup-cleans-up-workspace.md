---
"@tailor-platform/create-sdk": patch
---

The `workflow` template's e2e `globalSetup` now deletes the workspace it created when the deploy or a later setup step fails, instead of relying on the test runner calling `teardown` after a failed setup. A failing workspace delete is logged as a warning and no longer replaces the original error.
