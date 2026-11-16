---
"@tailor-platform/sdk": patch
---

When every step of a multi-step TailorDB migration completes but `tailor deploy` cannot make a field required because records have no value for it, the error's suggestion now says that the next deploy does not run completed steps again, so editing one has no effect, and how to fill in the records: rename the step or add one, and pass the other completed steps to `--migration-skip-steps`.
