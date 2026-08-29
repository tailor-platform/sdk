---
"@tailor-platform/sdk": patch
---

Serialize `tailor deploy`, `tailor remove`, and the `tailordb migration set`/`sync`/`rebaseline` commands per workspace and application, wherever they are started from: a second run waits for the first to finish instead of interleaving with it, and a run that was interrupted is reclaimed automatically after about 90 seconds.
