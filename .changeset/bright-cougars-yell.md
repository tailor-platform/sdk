---
"@tailor-platform/sdk-plugin-setup": patch
"@tailor-platform/sdk": patch
---

`tailor setup ci preview` now deletes the preview workspace of a pull request closed with merge conflicts, which GitHub never ran the preview workflow's cleanup for. Cleanup moves into a separate workflow, `tailor-<name>-preview-cleanup.yml`, which starts on `pull_request_target` and runs only the default branch's code. Run `tailor setup update` to regenerate existing preview workflows: the `tailor-preview-cleanup` job moves into the new workflow together with the steps and settings you added to it, and `setup update` stops if a job of yours `needs` it. A job of yours in the preview workflow that runs when the pull request is closed no longer runs; move it into the cleanup workflow. Commit the new workflow to the default branch, since GitHub runs it from there, and allow the default branch in the target's GitHub Environment if it restricts which branches can deploy.
