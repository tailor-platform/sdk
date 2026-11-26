---
"@tailor-platform/sdk": minor
---

`recordCreatedTrigger()`, `recordUpdatedTrigger()`, `recordDeletedTrigger()`, `recordTrigger()`, and `resolverExecutedTrigger()` take an optional `namespace` that names the TailorDB or resolver namespace of the table or resolver they subscribe to. When several namespaces of a config define the name and the trigger names none, `tailor deploy` stops with `DEPLOY_RESOURCE_NAMESPACE_AMBIGUOUS` instead of subscribing to the first, and an executor on one namespace's table or resolver no longer turns on events for the same-named one in another namespace. A plugin's record trigger config takes `namespace` too.

Without `userProfile.namespace`, an Auth service whose user profile table several namespaces define now asks for the namespace instead of using the first.
