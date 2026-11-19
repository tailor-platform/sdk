---
"@tailor-platform/sdk": patch
---

Fix resolvers and `machineUserAttributes` that use a TailorDB field defined with `.unique()`, `.index()`, `.vector()`, `.serial()`, or a decimal `scale`: they failed to load with an unrecognized key error
