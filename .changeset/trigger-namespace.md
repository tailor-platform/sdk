---
"@tailor-platform/sdk": minor
---

`recordCreatedTrigger()`, `recordUpdatedTrigger()`, `recordDeletedTrigger()`, `recordTrigger()`, and `resolverExecutedTrigger()` take an optional `namespace` that names the TailorDB or resolver namespace of the table or resolver they subscribe to. A record trigger that names no namespace for a table several namespaces of the config define makes `tailor deploy` stop with `DEPLOY_RESOURCE_NAMESPACE_AMBIGUOUS`; a resolverExecuted trigger in that case keeps subscribing to the first namespace and `deploy` now warns. An executor on one namespace's table or resolver no longer turns on events for the same-named one in another namespace, and a `publishEvents: false` conflict names the namespace of such a table or resolver. A plugin's record trigger config takes `namespace` too.

Without `userProfile.namespace`, an Auth service whose user profile table several namespaces define now asks for the namespace instead of using the first.
