---
"@tailor-platform/sdk": minor
---

Add `tailor workflow run <file>`, which runs a script as a temporary workflow so it can outlive the time limit of `tailor function run`. It waits for the script to finish, prints its logs and result, and removes the temporary resources. `--job` runs one workflow job of the file, and `--cleanup` removes the resources of runs whose wait was cut short (`--timeout`).
