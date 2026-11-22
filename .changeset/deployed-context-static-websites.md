---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": minor
---

The context of the `onDeployed` plugin hook now has `staticWebsites`, the static websites of the config that registers the plugin keyed by name, which the plugin can `publish` to. Its `application` is deprecated and will be removed in v3: read the registering config's applications from `applications`, picking those whose `configPath` equals the context's `configPath`. `tailor upgrade` to v3 runs the `v3/plugin-context-application` codemod, which reports plugins that read `application` for a manual change.
