---
"@tailor-platform/sdk-plugin-setup": patch
"@tailor-platform/sdk": patch
---

The ERD preview job that `tailor setup ci branch --erd-preview` generates now installs Corepack itself when the base branch uses yarn, so it no longer fails with `corepack: command not found` on runners or container images without one, such as those with only Node.js 25 or later. When the head branch uses pnpm, the job also runs the pnpm that the head's setup installs instead of a Corepack pnpm shim. Run `tailor setup update` to regenerate existing workflows.
