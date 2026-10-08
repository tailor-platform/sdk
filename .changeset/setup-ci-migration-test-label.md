---
"@tailor-platform/sdk-plugin-setup": minor
---

Add `--migration-test` to `tailor setup ci branch`. The generated workflow gains a job that runs `tailordb migration test` when a pull request gets the `tailor:migration-test` label (change it with `--migration-test-label`), then removes the label whether the test passed, failed, or was cancelled. Use `--migration-test-environment` to read the source workspace from a dedicated GitHub Environment instead of the plan/deploy one, and `--migration-test-data seed` to test against seed fixtures instead of cloned data. `tailor setup ci env` lists what the dedicated environment needs.
