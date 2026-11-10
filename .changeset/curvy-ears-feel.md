---
"@tailor-platform/sdk": patch
---

`tailor deploy`, `tailor tailordb migration sync`, and `tailor tailordb migration resolve` now report a table update that is refused because records have no value for a newly required field with the error code `TAILORDB_REQUIRED_FIELD_HAS_NULL_VALUES` and the remediation in `error.suggestion`. Under `--json` the error used to carry only `RPC_FAILED_PRECONDITION`, with the remediation printed as text on stderr; human output now shows it on the error's `Suggestion:` line, and code that calls `deploy()` reads it with `errorToJson()` instead of from stderr. When no migration covers the change, `tailor deploy` now suggests filling in the missing values and deploying again, and suggests `tailor tailordb migration generate`, with the deploy's `--config`, only for a namespace with `migration` configured. A migration that stays in progress because its in-progress record could not be cleared keeps the remediation of the failure that stopped it.
