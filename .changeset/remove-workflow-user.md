---
"@tailor-platform/sdk": patch
---

Remove `user` from `WorkflowJobContext` — the platform's workflow runtime does not inject a `user` global variable into the JS execution environment, so the field was always undefined. Also remove `WORKFLOW_TEST_USER_KEY` constant.
