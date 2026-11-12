---
"@tailor-platform/sdk": patch
---

`tailor deploy` now fetches the full definition of each existing executor it plans to keep, and compares the local executor against that instead of the executor list. Deploy plans stay the same, and the comparison keeps working when the platform stops returning target configurations in the executor list.
