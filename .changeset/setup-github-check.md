---
"@tailor-platform/sdk": minor
---

`setup github --check` (beta): audit generated workflows for drift

Adds a read-only `--check` mode that compares each managed target in `.github/tailor-sdk.lock` against the current config and repository state and reports drift: a missing or hand-edited workflow file, an outdated template version, a missing `tailor.config.ts` under the recorded `--dir`, or a default branch that no longer matches the workflow trigger. Each finding names a stable rule key, and the command exits non-zero when drift is found.
