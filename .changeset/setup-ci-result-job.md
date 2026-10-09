---
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk": patch
---

`tailor setup ci branch` and `tailor setup ci preview` now generate a final job, `tailor-result` and `tailor-preview-result`, whose check (such as `tailor-result (my-app)`) reports whether the whole workflow passed, so branch protection needs only that one check instead of every job. It fails when a job it needs failed or was cancelled and passes when they succeeded or were skipped. Add your own jobs, such as end-to-end tests or a matrix job, to its `needs` to make them count; regenerating the workflow keeps them, and `tailor setup check` does not report them as hand edits.

Run `tailor setup update` to add the job to existing workflows with the flags they were generated with; `tailor setup check` reports them as outdated until then. If every managed job uses the same `runs-on` you set, for example self-hosted runners, the new job uses it too; otherwise, set it on the new job yourself.
