---
"@tailor-platform/sdk-plugin-tailordb-erd": patch
---

`tailor tailordb erd` commands now report a failure under `--json` as a JSON `{ "error": { "code", "message" } }` line on stderr, like the other Tailor CLI commands, instead of human-readable text.
