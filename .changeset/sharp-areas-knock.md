---
"@tailor-platform/sdk-plugin-setup": patch
"@tailor-platform/sdk": patch
---

Labeling a closed pull request, such as one already merged, no longer deploys a preview workspace from the preview workflow that `tailor setup ci preview --require label` generates. The cleanup workflow had already run when the pull request closed, so such a workspace stayed until a later cleanup run deleted it after its 7-day `ttl` expired. The `tailor-preview-deploy` job of every preview workflow now skips events on a closed pull request, and your jobs that need it are skipped with it.

This release also raises the workflow template version, so `tailor setup check` reports a template-version finding for existing workflows until you run `tailor setup update`. With `TAILOR_PLATFORM_FAIL_ON_DRIFT` set to `true`, the drift check fails until then.
