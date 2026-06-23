# Setup Commands

Commands for setting up project infrastructure.

## setup

Generate a CI deploy workflow for your project. (beta)

**Usage**

```
tailor-sdk setup [options] [command]
```

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

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                       | Description                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------- |
| [`setup check`](#setup-check) | Audit generated workflows for drift against the current config/repo (read-only). |

### setup check

Audit generated workflows for drift against the current config/repo (read-only).

**Usage**

```
tailor-sdk setup check
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### setup check

Audit generated workflows for drift against the current config/repo (read-only).

**Usage**

```
tailor-sdk setup check
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

## Further reading

- [GitHub Actions Integration](../github-actions.md) — usage guide: targets, generated files, secrets, approval gates, and rollback.
