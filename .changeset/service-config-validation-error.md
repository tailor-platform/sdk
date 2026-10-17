---
"@tailor-platform/sdk": patch
---

Report an invalid TailorDB, IdP, Auth, static website, AI Gateway, or secret manager config as a `SERVICE_CONFIG_INVALID` error that lists each offending field, instead of an `UNEXPECTED_ERROR` carrying the raw validation output. Under `--json`, `error.context` carries `configKey`, `name`, and `issues` (`path` and `message` per field).
