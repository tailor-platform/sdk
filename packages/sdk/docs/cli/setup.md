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
| `--action <ACTION>`                 | -     | Generate a per-app composite action instead of a full workflow. The action is written to .github/actions/tailor-<name>/action.yml.                | No       | -          |
| `--preview`                         | -     | Generate a preview workflow (PR label-triggered deploy to per-PR workspace).                                                                      | No       | `false`    |
| `--force`                           | -     | Discard hand edits / take over unmanaged files and regenerate                                                                                     | No       | `false`    |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                 | Description                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`setup check`](#setup-check)           | Audit generated workflows for drift against the current config/repo (read-only).                 |
| [`setup coordinate`](#setup-coordinate) | Generate a coordinator workflow that orchestrates multiple --action-generated composite actions. |

### setup check

Audit generated workflows for drift against the current config/repo (read-only).

**Usage**

```
tailor-sdk setup check [options]
```

**Options**

| Option | Alias | Description                                                                                      | Required | Default |
| ------ | ----- | ------------------------------------------------------------------------------------------------ | -------- | ------- |
| `--ci` | -     | Run in CI mode: skip checks that are handled by the runtime (e.g. TAILOR_PLATFORM_WORKSPACE_ID). | No       | `false` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### setup coordinate

Generate a coordinator workflow that orchestrates multiple --action-generated composite actions.

**Usage**

```
tailor-sdk setup coordinate [options]
```

**Options**

| Option                              | Alias | Description                                                                             | Required | Default |
| ----------------------------------- | ----- | --------------------------------------------------------------------------------------- | -------- | ------- |
| `--workspace-name <WORKSPACE_NAME>` | `-n`  | Coordinator name (used in the generated workflow file name and job names)               | Yes      | -       |
| `--action <ACTION>`                 | -     | Composite action to include (can be specified multiple times). tailor- prefix optional. | No       | `[]`    |
| `--branch <BRANCH>`                 | -     | Branch target: deploy trigger branch (defaults to the detected default branch)          | No       | -       |
| `--tag`                             | -     | Generate a tag target coordinator                                                       | No       | `false` |
| `--preview`                         | -     | Generate a preview coordinator                                                          | No       | `false` |
| `--environment <ENVIRONMENT>`       | -     | GitHub Environment for the plan/deploy jobs                                             | No       | -       |
| `--force`                           | -     | Discard hand edits and regenerate                                                       | No       | `false` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

## Further reading

- [GitHub Actions Integration](../github-actions.md) — usage guide: targets, generated files, secrets, approval gates, and rollback.
