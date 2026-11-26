---
"@tailor-platform/sdk": patch
---

Deploy applies resources in the same order as before, and on a failure still writes the queued resource labels and lifts held TailorDB maintenance modes before reporting it; that order is now checked against a failure of every apply call.
