---
"@tailor-platform/create-sdk": patch
---

Document why the `multi-application` template ships with fully open permissions: the README gained a Security section listing the open `unsafeAllowAllTypePermission` / `unsafeAllowAllGqlPermission` grants on the `User` and `AdminNote` tables and pointing at the TailorDB Permission documentation for what to replace them with.
