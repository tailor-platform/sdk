---
"@tailor-platform/sdk": patch
---

Report every pre-flight validation failure of `tailor deploy` at once: violations from all configs in the run are listed together, and the `DEPLOY_VALIDATION_FAILED` error carries them in `error.context.issues` under `--json`.

Warnings for requests that could not be validated now identify their application.
