---
"@tailor-platform/sdk": minor
---

Add the `TAILOR_OUTPUT` environment variable to default CLI output to JSON without passing `--json` on every call, for agents, scripts, and CI. An explicit `--json` still wins, so existing pipes, CI steps, and CLI plugins keep their current output unless the variable is set.
