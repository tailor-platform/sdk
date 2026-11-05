---
"@tailor-platform/sdk": patch
---

The `tailor tailordb migration generate` and `tailor deploy` commands that `tailor tailordb migration rebaseline` suggests now pass `--config` the way its other suggested commands do: relative to the current directory, and omitted for the default config. They passed the config file's absolute path before.
