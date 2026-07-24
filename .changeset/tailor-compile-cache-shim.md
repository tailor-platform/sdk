---
"@tailor-platform/sdk": patch
---

`tailor` now starts faster on repeated runs: the CLI binary is a small shim that enables Node's on-disk compile cache before loading the real CLI, so its full module graph is cached across invocations instead of only the lazily-loaded parts.
