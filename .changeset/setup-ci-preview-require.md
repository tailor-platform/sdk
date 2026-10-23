---
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk": patch
---

`tailor setup ci preview` takes `--require <ready|label>` instead of `--require-preview-label`. By default every pull request now gets a preview, draft pull requests included, which the generated workflow used to skip. `--require ready` skips draft pull requests and also triggers on `ready_for_review`, so a draft that is marked ready for review gets its preview right away instead of waiting for the next push. `--require label` deploys only pull requests labeled `tailor:preview`, as `--require-preview-label` did, and now also for a labeled draft. The requirement is recorded in `.github/tailor.lock` as `require`, so `tailor setup update` regenerates the same workflow.

`--require-preview-label` is removed: use `--require label`. `setup` remains a beta command, so this ships as an immediate change rather than going through a deprecation cycle. A preview target recorded before this change is read by `tailor setup update` as `--require ready`, or as `--require label` if it required the label: the first keeps skipping drafts and gains the `ready_for_review` trigger, and the second now also deploys a labeled draft. To deploy drafts as well, run `tailor setup ci preview` again without `--require`.
