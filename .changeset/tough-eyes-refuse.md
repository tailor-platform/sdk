---
"@tailor-platform/sdk": patch
---

Reload user modules (config, tailordb types, workflows, resolvers, executors, HTTP adapters) on every `deploy()` run, so calling the programmatic `deploy()` repeatedly in one Node process picks up file changes and re-registers wait point keys instead of silently reusing modules cached by an earlier run.
