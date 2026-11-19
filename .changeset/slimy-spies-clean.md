---
"@tailor-platform/sdk": minor
---

Commands that create a single resource, such as `tailor secret vault create` and `tailor secret create`, and clients from `initOperatorClient` now handle a resource that already exists the same way every time:

- They no longer save a crash report or print "An unexpected error occurred" before the already-exists error.
- When a create is retried automatically after a transient error and the retry finds the resource, they now fail with the already-exists error instead of reporting success. Before, `tailor secret create` for an existing secret could report the secret as created while it kept its old value. The same error now also appears when the first attempt did create the resource but its response was lost; check the resource before creating it again.

Deploys (`tailor deploy`, `tailor tailordb migration test`, and `deploy()`), `tailor tailordb migration sync`, and `tailor tailordb migration resolve` keep their handling. To give your own client that handling, pass `createsPlannedResources: true` to `initOperatorClient`.
