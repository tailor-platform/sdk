---
"@tailor-platform/sdk-plugin-frontend": minor
---

The `env` and `build` callbacks now receive `staticWebsites`, the static websites of the config that registers `frontendPlugin` keyed by name. Their `application` is deprecated: find the application in `applications` by name instead. `frontendPlugin` now reads the site to publish from the deploy's `staticWebsites`, so it needs an SDK version whose `onDeployed` context has `staticWebsites`.
