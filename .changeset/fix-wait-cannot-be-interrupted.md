---
"@tailor-platform/sdk": patch
---

Fix `workflow executions --wait`, `workflow start --wait`, and `executor jobs --wait` not responding to Ctrl+C in some terminals. Disable ora's `discardStdin` so stdin stays in cooked mode and SIGINT is delivered by the terminal directly.
