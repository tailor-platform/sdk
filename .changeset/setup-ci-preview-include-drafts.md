---
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk": patch
---

Add `--include-drafts` to `tailor setup ci preview` to deploy a preview for draft pull requests as well. Without it, drafts are still skipped, and the generated preview workflow now also triggers on `ready_for_review`, so a draft that is marked ready for review gets its preview right away instead of waiting for the next push. This applies to `--require-preview-label` too: a labeled draft deploys once it is marked ready. The option is recorded in `.github/tailor.lock`, so `tailor setup update` regenerates the same workflow. Run `tailor setup update` to add the new trigger to existing preview workflows.
