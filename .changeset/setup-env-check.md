---
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk": patch
---

Add `tailor setup ci env --check`, which reads GitHub with `gh` and reports which secrets and variables each GitHub Environment used by the generated workflows still lacks. It fails when a required entry is missing, only reports missing optional ones, and prints the `gh` commands that set the missing entries together with where each value comes from. Entries set on the repository or organization count as registered, and an entry registered as the wrong kind (a secret where the workflow reads a variable) is pointed out. When `gh` is not installed, not logged in, or cannot read the repository's secrets and variables, the check says so instead of reporting entries as missing. The next steps printed after `tailor setup ci branch`, `tag`, and `preview` now suggest running it.

When the `origin` remote is not on github.com, `tailor setup ci env` now names the repository that `gh repo view` reports, with its host on GitHub Enterprise Server, instead of leaving it to `gh` at run time: the printed `gh` commands pass that host, and the Terraform output sets `GITHUB_BASE_URL` to it. `--check` prints its commands for the host it checked. When `gh` cannot tell the repository, the output says how to point `gh` and Terraform at a GitHub Enterprise Server host.
