---
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk": patch
---

The workflows `tailor setup ci` generates now run on GitHub Enterprise Server: the plan comment, change detection, preview deployment, and ERD preview comment call the GitHub API of the server the workflow runs on instead of github.com. Run `tailor setup update` to regenerate existing workflows.

GitHub Enterprise Server does not support the artifact upload the ERD preview uses, so pass `--ghes` with `--erd-preview` to `tailor setup ci branch` there: each ERD viewer is then uploaded as a zip file, and the pull request comment links to the workflow run. The GitHub Actions guide lists the runner and action setup GitHub Enterprise Server needs.
