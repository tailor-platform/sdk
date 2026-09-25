---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": patch
"@tailor-platform/sdk-plugin-seed": patch
"@tailor-platform/sdk-plugin-setup": patch
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

Add the `TAILOR_JSON_OUTPUT` environment variable to default CLI output to JSON without passing `--json` on every call, for agents, scripts, and CI. Set it to `true` or `1` to enable JSON; `false` or `0` keeps table output. An explicit `--json` still wins, and with the variable unset every command keeps its current output, so existing pipes and CI steps are unaffected. Dispatched CLI plugins inherit the variable from the environment.
