---
"@tailor-platform/sdk": patch
---

Most errors and warnings that quote a failure's message, such as the TailorDB migration and temporary resource cleanup warnings, now end with it, so a message that already ends with a period no longer gets a second one (`Build failed..`). `DEPLOYED_HOOK_FAILED` lists the hooks that did not run in its details instead of its message.
