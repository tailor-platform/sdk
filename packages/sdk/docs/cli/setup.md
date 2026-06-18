# Setup Commands

Commands for setting up project infrastructure.

<!-- politty:command:setup:heading:start -->

## setup

<!-- politty:command:setup:heading:end -->

<!-- politty:command:setup:description:start -->

Generate a CI deploy workflow for your project. (beta)

<!-- politty:command:setup:description:end -->

<!-- politty:command:setup:usage:start -->

**Usage**

```
tailor-sdk setup [options] [command]
```

<!-- politty:command:setup:usage:end -->

<!-- politty:command:setup:options:start -->

**Options**

| Option                              | Alias | Description                                                                                                                                       | Required | Default    |
| ----------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- |
| `--provider <PROVIDER>`             | `-p`  | CI provider to generate for (only 'github' is supported)                                                                                          | No       | `"github"` |
| `--workspace-name <WORKSPACE_NAME>` | `-n`  | Workspace name (defaults to the config 'name')                                                                                                    | No       | -          |
| `--branch <BRANCH>`                 | -     | Branch target: deploy trigger branch (defaults to the detected default branch). Tag target: tag-reachability guard branch (no guard when omitted) | No       | -          |
| `--tag`                             | -     | Generate a tag target (deploy on tag push)                                                                                                        | No       | `false`    |
| `--tag-pattern <TAG_PATTERN>`       | -     | Tag glob to match (requires --tag; defaults to v\*)                                                                                               | No       | -          |
| `--environment <ENVIRONMENT>`       | -     | GitHub Environment for the plan/deploy jobs (defaults to the workspace name)                                                                      | No       | -          |
| `--no-plan`                         | -     | Disable the plan job for a branch target (cannot be combined with --tag)                                                                          | No       | `false`    |
| `--dir <DIR>`                       | `-d`  | App directory (for monorepo setups)                                                                                                               | No       | `"."`      |
| `--force`                           | -     | Discard hand edits / take over unmanaged files and regenerate                                                                                     | No       | `false`    |

<!-- politty:command:setup:options:end -->

<!-- politty:command:setup:subcommands:start -->

**Commands**

| Command                       | Description                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------- |
| [`setup check`](#setup-check) | Audit generated workflows for drift against the current config/repo (read-only). |

<!-- politty:command:setup:subcommands:end -->

<!-- politty:command:setup:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:setup:global-options-link:end -->

<!-- politty:command:setup check:heading:start -->

### setup check

<!-- politty:command:setup check:heading:end -->

<!-- politty:command:setup check:description:start -->

Audit generated workflows for drift against the current config/repo (read-only).

<!-- politty:command:setup check:description:end -->

<!-- politty:command:setup check:usage:start -->

**Usage**

```
tailor-sdk setup check
```

<!-- politty:command:setup check:usage:end -->

<!-- politty:command:setup check:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:setup check:global-options-link:end -->

## Further reading

- [GitHub Actions Integration](../github-actions.md) — usage guide: targets, generated files, secrets, approval gates, and rollback.
