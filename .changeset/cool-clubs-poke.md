---
"@tailor-platform/sdk": patch
---

feat: Support optional namespace for userProfile in auth config

- Auto-resolve namespace when only one TailorDB exists (including external)
- Allow explicit namespace specification when multiple TailorDBs exist
