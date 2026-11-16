---
"@tailor-platform/sdk": patch
---

Fix Ctrl-C at an interactive prompt (for example the `Client secret` prompt of `tailor login --machine-user`) printing `User force closed the prompt with SIGINT` and exiting with 1. It exits with 130 and no error again.
