---
"@tailor-platform/sdk-plugin-setup": patch
---

`tailor setup check`, `tailor setup ci autofix`, and `tailor setup update` no longer treat an `environment:` you add to the `tailor-autofix` or `tailor-autofix-push` job of the autofix workflow as a hand edit, as they already do for the other managed jobs generated without one.
