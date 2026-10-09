---
"@tailor-platform/sdk-plugin-setup": minor
---

`tailor setup ci branch`, `tag`, and `preview` accept `--package-manager` (`pnpm`, `npm`, `yarn`, or `bun`) to choose the package manager the generated workflow uses, for example to generate the workflow before the lockfile exists. `.github/tailor.lock` records the choice, and `tailor setup update` keeps it.

Without the flag, the package manager is still detected from the lockfile at the repository root (now including `npm-shrinkwrap.json`), and otherwise from the `packageManager` or `devEngines.packageManager` field of the root `package.json`. When neither names one, `setup ci` and `setup update` stop with an error instead of silently choosing npm, which produced a workflow that failed in CI without a lockfile at the repository root. `setup` remains a beta command, so this ships as an immediate change rather than going through a deprecation cycle.
