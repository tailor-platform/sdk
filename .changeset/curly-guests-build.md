---
"@tailor-platform/sdk-plugin-setup": patch
"@tailor-platform/sdk": patch
---

The workflows `tailor setup ci` generates now use tailor-platform/actions v2.9.0. Branch pushes and manual runs save the SDK bundle cache, and pull request and tag runs restore the one saved on the base or default branch, so plan, deploy, and preview deployment jobs rebuild only the bundles whose sources changed. Each saved entry counts toward the repository's Actions cache limit. A failed plan job's log now also shows the CLI's error. On GitHub Enterprise Server, make the pinned `actions/cache` version available on the server before your workflows move to v2.9.0, whether through `tailor setup update` or Renovate.
