---
"@tailor-platform/sdk-codemod": patch
---

Add LLM-assisted review support to the codemod runner. A codemod can declare `suspiciousPatterns` plus a `prompt`; after running, files whose post-transform content still matches a suspicious pattern are reported as `llmReviews` (in the JSON output and on stderr) together with the codemod's migration prompt. This surfaces the cases a deterministic transform cannot safely complete (e.g. a value reached through a variable) so they can be finished with an LLM. The `auth.invoker(...)` codemod adopts this for its non-literal-argument cases.
