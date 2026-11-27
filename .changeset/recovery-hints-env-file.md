---
"@tailor-platform/sdk": patch
---

Keep `--env-file` and `--env-file-if-exists` in the `tailor` commands the CLI suggests with the run's workspace or profile and in `Next:` commands, such as the `tailor function logs` and `tailor workflow prune` commands printed when `tailor function run --async` stops waiting, or `tailor login` when no token is found. Most of them used to leave them out, so pasting one skipped the env files and could fail to authenticate when the token came from one. Each env file is named by its absolute path, so it still loads when the command runs from another directory.
