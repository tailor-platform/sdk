# Setup Commands

Commands for setting up project infrastructure.

<!-- politty:command:setup:heading:start -->

## setup

<!-- politty:command:setup:heading:end -->

<!-- politty:command:setup:description:start -->

Set up project infrastructure.

<!-- politty:command:setup:description:end -->

<!-- politty:command:setup:usage:start -->

**Usage**

```
tailor-sdk setup [command]
```

<!-- politty:command:setup:usage:end -->

<!-- politty:command:setup:subcommands:start -->

**Commands**

| Command                         | Description                                       |
| ------------------------------- | ------------------------------------------------- |
| [`setup github`](#setup-github) | Generate a GitHub Actions deploy workflow. (beta) |

<!-- politty:command:setup:subcommands:end -->

<!-- politty:command:setup:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:setup:global-options-link:end -->
<!-- politty:command:setup github:heading:start -->

### setup github

<!-- politty:command:setup github:heading:end -->

<!-- politty:command:setup github:description:start -->

Generate a GitHub Actions deploy workflow. (beta)

<!-- politty:command:setup github:description:end -->

<!-- politty:command:setup github:usage:start -->

**Usage**

```
tailor-sdk setup github [options]
```

<!-- politty:command:setup github:usage:end -->

<!-- politty:command:setup github:options:start -->

**Options**

| Option                              | Alias | Description                                                                                                                                       | Required | Default |
| ----------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- |
| `--workspace-name <WORKSPACE_NAME>` | `-n`  | Workspace name (defaults to the config 'name')                                                                                                    | No       | -       |
| `--branch <BRANCH>`                 | -     | Branch target: deploy trigger branch (defaults to the detected default branch). Tag target: tag-reachability guard branch (no guard when omitted) | No       | -       |
| `--tag`                             | -     | Generate a tag target (deploy on tag push)                                                                                                        | No       | `false` |
| `--tag-pattern <TAG_PATTERN>`       | -     | Tag glob to match (requires --tag; defaults to v\*)                                                                                               | No       | -       |
| `--environment <ENVIRONMENT>`       | -     | GitHub Environment for the plan/deploy jobs (defaults to the workspace name)                                                                      | No       | -       |
| `--no-plan`                         | -     | Disable the plan job for a branch target (cannot be combined with --tag)                                                                          | No       | `false` |
| `--dir <DIR>`                       | `-d`  | App directory (for monorepo setups)                                                                                                               | No       | `"."`   |
| `--force`                           | -     | Discard hand edits / take over unmanaged files and regenerate                                                                                     | No       | `false` |

<!-- politty:command:setup github:options:end -->

<!-- politty:command:setup github:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:setup github:global-options-link:end -->

## Further reading

- [GitHub Actions Integration](../github-actions.md) — usage guide: targets, generated files, secrets, approval gates, and rollback.
