---
"@tailor-platform/sdk-plugin-setup": minor
---

Remove `tailor setup ci coordinate` and `tailor setup ci action`. To deploy several apps from one workflow, pass `--dir` repeatedly to `tailor setup ci branch`, `tag`, or `preview` (for example `--dir apps/a --dir apps/b --name platform`); the apps are planned and deployed in a single multi-config run. `setup` remains a beta command, so this ships as an immediate change rather than going through a deprecation cycle.

A `.github/tailor.lock` that still records a `coordinate` or `action` target now fails to load with an error naming the entry. Delete the generated coordinator workflow, the per-app composite actions, and their entries in `.github/tailor.lock`, then regenerate with `setup ci branch --dir <a> --dir <b> --name <name>` (or `tag` / `preview`).

The per-app composite action's `tailor-build-site` step (the slot for a static website build command) has no equivalent in the `branch`, `tag`, or `preview` workflows. If you relied on it, add your build step to the generated workflow before the deploy step; steps you add are kept when the workflow is regenerated.
