---
"@tailor-platform/sdk-plugin-setup": minor
---

Add `--split-plan-environment` to `tailor setup ci branch`. The plan job, which pull requests run with their own code, then runs in a GitHub Environment of its own, named after the deploy environment with `-plan` appended, where it signs in with a machine user that needs only a viewer role instead of the deploy one. `tailor setup ci env` lists what the plan environment needs, `tailor setup ci env --check` counts its machine user only when set on that environment, and `tailor setup update` keeps the flag. To keep a pull request from moving the plan job back into the deploy environment, limit that environment's deployment branches to the target branch.
