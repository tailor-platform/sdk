---
"@tailor-platform/sdk": patch
---

Stop `tailor deploy` from reporting `Table '<name>' scripts differ between remote and snapshot` when the machine running it uses a different system locale from the one that last deployed. The TailorDB script hash sorted field names with the default locale, so a locale such as Czech, Slovak, Lithuanian or Estonian could order the fields differently and fail the deploy with remote schema drift. Hashes from en-US, ja-JP and C locales are unchanged.
