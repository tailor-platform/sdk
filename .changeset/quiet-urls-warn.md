---
"@tailor-platform/sdk": patch
---

`PLATFORM_URL` and `PLATFORM_OAUTH2_CLIENT_ID`, which v2 renamed to `TAILOR_PLATFORM_URL` and `TAILOR_PLATFORM_OAUTH2_CLIENT_ID`, still work when the new names are not set, but now print a deprecation warning once per run; rename them to the new names. An empty value of any of these variables now counts as unset.
