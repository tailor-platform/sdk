---
"@tailor-platform/sdk": patch
---

Errors about a missing or unknown Auth service, IdP, invoker, or migration machine user now point at the file to fix: `tailor deploy`, `tailor tailordb migration validate`, and `tailor tailordb migration test` prefix the message with that file, put it in `error.context.file`, and annotate it in GitHub Actions. A service or machine user the config lacks (`AUTH_CONFIG_REQUIRED`, `MACHINE_USER_REQUIRED`, `MACHINE_USER_NOT_FOUND`, `AUTH_MACHINE_USER_NOT_FOUND`, `EXECUTOR_IDP_REQUIRED`, `INVOKER_AUTH_REQUIRED`) points at the config; a value an executor trigger or a resolver or executor invoker names (`EXECUTOR_IDP_NOT_FOUND`, `EXECUTOR_IDP_AMBIGUOUS`, `INVOKER_MACHINE_USER_NOT_FOUND`) points at that executor or resolver file. The `AUTH_CONFIG_REQUIRED` error for an executor with an `authAccessToken` trigger now also names the executor and suggests defining an Auth service in the config.
