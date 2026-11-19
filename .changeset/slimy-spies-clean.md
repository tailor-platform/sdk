---
"@tailor-platform/sdk": minor
---

Commands such as `tailor secret vault create` and `tailor secret create`, and clients from `initOperatorClient`, no longer save a crash report or print "An unexpected error occurred" when a create fails because the resource already exists. Deploys still report it, whether from `tailor deploy`, `tailor tailordb migration test`, or `deploy()`; to report it from your own client, pass `reportUnexpectedAlreadyExists: true` to `initOperatorClient`.
