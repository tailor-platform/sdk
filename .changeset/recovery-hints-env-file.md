---
"@tailor-platform/sdk": patch
---

Keep `--env-file` and `--env-file-if-exists` in the `tailor` command lines the CLI suggests, such as the `tailor function logs` and `tailor workflow prune` commands printed when `tailor function run --async` stops waiting, or `tailor login` when no token is found. A suggested command used to leave them out, so pasting it skipped the env files and could fail to authenticate when the token came from one. Each env file is named by its absolute path, so the command runs from any directory.
