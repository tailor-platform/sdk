---
"@tailor-platform/sdk": minor
---

Add the `TAILOR_OUTPUT` environment variable to default CLI output to JSON without passing `--json` on every call, for agents, scripts, and CI. An explicit `--json` still wins, and with the variable unset every command keeps its current output, so existing pipes and CI steps are unaffected. Dispatched CLI plugins inherit the variable from the environment.
