---
"@tailor-platform/sdk": patch
---

Document that an executor with an incoming webhook trigger, when triggered manually with `tailor executor trigger` or `triggerExecutor`, receives no `rawBody` and empty `headers`, in the executor guide and in the JSDoc of the webhook `rawBody` and `headers` args. An executor that verifies a signature over `rawBody` rejects such a run, so test it through its webhook URL.
