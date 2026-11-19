---
"@tailor-platform/sdk-plugin-setup": patch
---

Internal refactoring: type checking now catches a `tailor setup ci` option that `tailor setup update` would not carry over from `.github/tailor.lock`, and `tailor setup ci` and `tailor setup check` load app configs with one shared implementation. Generated workflows, the lock file, and drift findings are unchanged.
