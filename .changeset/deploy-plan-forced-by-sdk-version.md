---
"@tailor-platform/sdk": minor
---

`tailor deploy` now marks updates that show no configuration difference and are applied again only because the application's resources were last deployed with a different SDK version. The plan lists them with `[forced by SDK version]` and the summary counts them (`12 to update (11 forced by SDK version)`), so after an SDK upgrade you can tell them apart from real configuration changes. With `--json`, such changes carry `forcedBySdkVersion: true` and `summary.forcedBySdkVersion` counts them.
