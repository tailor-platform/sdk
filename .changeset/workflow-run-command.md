---
"@tailor-platform/sdk": minor
---

Add `tailor workflow run <file>`, which runs a script as a temporary workflow so it can outlive the time limit of `tailor function run`. It waits for the script to finish, prints its logs and result, and removes the temporary resources. `--job` runs one workflow job of the file. `tailor workflow cleanup` removes the resources of runs whose wait was cut short (`--timeout`), and warns about resources named `tmp-run-…` that carry no label; `--include-unlabeled` removes those too. `tailor deploy` also removes the resources of finished runs at its end, and never fails because of it.
