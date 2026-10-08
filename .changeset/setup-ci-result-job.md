---
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk": patch
---

`tailor setup ci branch` and `tailor setup ci preview` now generate a final job, `tailor-result` and `tailor-preview-result`, whose check (such as `tailor-result (my-app)`) reports whether the whole workflow passed, so branch protection needs only that one check instead of every job. It fails when a job it needs failed or was cancelled and passes when they succeeded or were skipped. Add your own jobs, such as end-to-end tests or a matrix job, to its `needs` to make them count; re-running `tailor setup ci` keeps them and `tailor setup check` does not report them as hand edits. Re-run `tailor setup ci` (or `tailor setup update`) to add the job to an existing workflow.
