---
"@tailor-platform/sdk": patch
---

Fix `tailor-sdk api <endpoint>` writing its JSON response to stderr instead of stdout. The response now goes to stdout (matching `api list` / `api inspect`), so `-j` output can be piped to other tools.
