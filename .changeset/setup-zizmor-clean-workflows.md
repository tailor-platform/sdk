---
"@tailor-platform/sdk-plugin-setup": patch
---

Generated workflows now pass a zizmor audit. `actions/checkout` steps set `persist-credentials: false`, except in the jobs that run the `plan` or `tag-guard` action, whose `git fetch` needs the token on private repositories; those keep it and carry a `# zizmor: ignore[artipacked]` comment saying why. Coordinator workflows keep referencing their local composite actions as `./.github/actions/...`, with a `# zizmor: ignore[self-repository]` comment, because the `$/` form needs Actions runner 2.336.0 or newer and is not available on GitHub Enterprise Server.

The workflow template version is bumped, so `tailor setup check` reports every generated target as outdated; run `tailor setup update` to regenerate them.
