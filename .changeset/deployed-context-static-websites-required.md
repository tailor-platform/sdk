---
"@tailor-platform/sdk": minor
---

**Breaking change (beta)**: `DeployedContext` now requires `staticWebsites`, so code that builds the context itself, such as a plugin test that calls `onDeployed`, fails to type-check until it adds `staticWebsites`: the registering config's sites keyed by name, the same ones its `application.staticWebsites` held.
