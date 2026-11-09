---
"@tailor-platform/sdk": patch
---

Speed up `tailor seed apply` and `tailor tailordb migration test` for a seed table too large for one chunk: splitting it took tens of seconds for a few MB of small records and now takes milliseconds
