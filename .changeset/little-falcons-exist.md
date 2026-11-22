---
"@tailor-platform/sdk": patch
---

Errors and warnings that quote a failure's message now end with it, so a message that already ends with a period no longer gets a second one (`Build failed..`). A warning prints the sentence that used to follow the quoted message on the next line; an error, or a warning that stays on one line, puts that sentence first and the quoted message last, after `Reason:`. `DEPLOYED_HOOK_FAILED` lists the hooks that did not run in its details instead of its message. This covers the TailorDB migration warnings and errors of `tailor deploy`; the temporary resource cleanup warnings of `tailor deploy`, `tailor tailordb migration resolve`, and `tailor seed apply`; the keep warnings of `tailor workspace prune`; the expiry warning of `tailor tailordb migration test`; and the schema snapshot error (`SCRIPT_SNAPSHOT_INVALID`) of `tailor function script` and `tailor function run`.
