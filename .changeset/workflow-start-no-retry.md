---
"@tailor-platform/sdk": patch
---

Starting a workflow, from `tailor workflow start` or for a TailorDB migration during `tailor deploy`, is no longer retried after a transient platform error, because the retry could start a second execution.
