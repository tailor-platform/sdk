---
"@tailor-platform/sdk": patch
---

Report a configuration change to an Auth connection in the `tailor deploy` plan as an update instead of a replacement. The plan marks it `~` instead of `±`, `--json` reports `"action": "update"` and counts it in `summary.update` instead of `summary.replace`, and pre-flight validation errors label it `(update)`. Deploy still updates the connection in place, as before.
