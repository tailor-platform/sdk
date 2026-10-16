---
"@tailor-platform/sdk": minor
"@tailor-platform/create-sdk": minor
"@tailor-platform/sdk-codemod": minor
"@tailor-platform/sdk-plugin-setup": minor
"@tailor-platform/sdk-plugin-seed": minor
"@tailor-platform/sdk-plugin-tailordb-erd": minor
---

The `tailor` CLI, the setup, seed, and TailorDB ERD plugins, `create-sdk`, and the codemod CLI now exit with code 2 when they reject the command line itself (an unknown option or subcommand, an unexpected argument, or an option value that fails validation), so scripts and agents can tell a mistyped command from one that failed while running, which still exits with 1. A script that checks for exactly 1 after a mistyped command needs to accept 2. `runMain` and `runCommand` from `@tailor-platform/sdk/cli` follow the same rule, so a CLI plugin built on them exits with 2 for these errors, and `runCommand` reports them with `exitCode` 2.
