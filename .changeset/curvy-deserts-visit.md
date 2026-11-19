---
"@tailor-platform/sdk-plugin-setup": patch
---

Internal refactoring: `tailor setup ci`, `tailor setup update`, and `tailor setup check` now load app configs with one shared implementation, and `tailor setup update` is checked to carry over every option `.github/tailor.lock` records. Generated workflows, the lock file, and drift findings are unchanged.
