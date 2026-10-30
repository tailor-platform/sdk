---
"@tailor-platform/sdk": minor
---

**Breaking change (beta)**: `tailor tailordb migration set` and `tailor tailordb migration sync` now refuse to run when the namespace records a migration history ID that does not match the local migration history, or one that cannot be read, instead of overwriting it after confirmation. A namespace with neither a checkpoint nor a history ID yet is still accepted. To write the local history over another one on purpose, pass the new `--force` option; the command names the history ID it replaces and still asks for confirmation unless `--yes` is given.
