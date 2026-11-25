---
"@tailor-platform/sdk": patch
---

`tailor deploy` now records its SDK version on the workspace as the `sdk-version` label after applying, keeping the workspace's other labels, so the version is recorded even for a config that deploys no application, such as one with only static websites. When the workspace cannot take the label, the deploy still succeeds, prints a warning, and adds a `workspaceSdkVersionNotRecorded` entry to the `--json` result's `warnings`.
