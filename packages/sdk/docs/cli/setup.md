# Setup Commands

Commands for setting up project infrastructure.

## setup

Generate CI deploy workflows for your project. (beta)

**Usage**

```
tailor-sdk setup <command>
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                 | Description                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`setup branch`](#setup-branch)         | Generate a branch-target deploy workflow (push to branch triggers deploy).                       |
| [`setup tag`](#setup-tag)               | Generate a tag-target deploy workflow (tag push triggers deploy).                                |
| [`setup preview`](#setup-preview)       | Generate a preview workflow (PR open/sync triggers deploy to a per-PR workspace).                |
| [`setup action`](#setup-action)         | Generate a per-app composite action for use with setup coordinate (monorepo multi-app deploys).  |
| [`setup coordinate`](#setup-coordinate) | Generate a coordinator workflow that orchestrates multiple --action-generated composite actions. |
| [`setup check`](#setup-check)           | Audit generated workflows for drift against the current config/repo (read-only).                 |

### setup action

Generate a per-app composite action for use with setup coordinate (monorepo multi-app deploys).

**Usage**

```
tailor-sdk setup action [options]
```

**Options**

| Option                        | Alias | Description                                         | Required | Default |
| ----------------------------- | ----- | --------------------------------------------------- | -------- | ------- |
| `--name <NAME>`               | `-n`  | Name (defaults to the config 'name')                | No       | -       |
| `--dir <DIR>`                 | `-d`  | App directory                                       | No       | `"."`   |
| `--environment <ENVIRONMENT>` | -     | GitHub Environment (defaults to the workspace name) | No       | -       |
| `--force`                     | -     | Discard hand edits and regenerate                   | No       | `false` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### setup branch

Generate a branch-target deploy workflow (push to branch triggers deploy).

**Usage**

```
tailor-sdk setup branch [options]
```

**Options**

| Option                        | Alias | Description                                                                    | Required | Default |
| ----------------------------- | ----- | ------------------------------------------------------------------------------ | -------- | ------- |
| `--name <NAME>`               | `-n`  | Name (defaults to the config 'name')                                           | No       | -       |
| `--branch <BRANCH>`           | -     | Deploy trigger branch (defaults to the detected default branch)                | No       | -       |
| `--environment <ENVIRONMENT>` | -     | GitHub Environment for the plan/deploy jobs (defaults to the workspace name)   | No       | -       |
| `--no-plan`                   | -     | Disable the plan job (deploy-only mode)                                        | No       | `false` |
| `--erd-preview`               | -     | Add PR ERD viewer artifacts with current/diff previews for TailorDB namespaces | No       | `false` |
| `--dir <DIR>`                 | `-d`  | App directory (for monorepo setups)                                            | No       | `"."`   |
| `--force`                     | -     | Discard hand edits / take over unmanaged files and regenerate                  | No       | `false` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

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

| Option                        | Alias | Description                                                                             | Required | Default |
| ----------------------------- | ----- | --------------------------------------------------------------------------------------- | -------- | ------- |
| `--name <NAME>`               | `-n`  | Coordinator name (used in the generated workflow file name and job names)               | Yes      | -       |
| `--action <ACTION>`           | -     | Composite action to include (can be specified multiple times). tailor- prefix optional. | No       | `[]`    |
| `--branch <BRANCH>`           | -     | Branch target: deploy trigger branch (defaults to the detected default branch)          | No       | -       |
| `--tag`                       | -     | Generate a tag target coordinator                                                       | No       | `false` |
| `--preview`                   | -     | Generate a preview coordinator                                                          | No       | `false` |
| `--environment <ENVIRONMENT>` | -     | GitHub Environment for the plan/deploy jobs                                             | No       | -       |
| `--force`                     | -     | Discard hand edits and regenerate                                                       | No       | `false` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### setup preview

Generate a preview workflow (PR open/sync triggers deploy to a per-PR workspace).

**Usage**

```
tailor-sdk setup preview [options]
```

**Options**

| Option                        | Alias | Description                                                               | Required | Default |
| ----------------------------- | ----- | ------------------------------------------------------------------------- | -------- | ------- |
| `--name <NAME>`               | `-n`  | Name (defaults to the config 'name')                                      | No       | -       |
| `--branch <BRANCH>`           | -     | Branch to filter PRs by (defaults to the detected default branch)         | No       | -       |
| `--region <REGION>`           | -     | Workspace region for preview workspace creation (e.g. us-west). Required. | Yes      | -       |
| `--require-preview-label`     | -     | Deploy preview only for PRs labeled `tailor:preview` instead of all PRs.  | No       | `false` |
| `--environment <ENVIRONMENT>` | -     | GitHub Environment for the preview jobs (defaults to the workspace name)  | No       | -       |
| `--dir <DIR>`                 | `-d`  | App directory (for monorepo setups)                                       | No       | `"."`   |
| `--force`                     | -     | Discard hand edits / take over unmanaged files and regenerate             | No       | `false` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### setup tag

Generate a tag-target deploy workflow (tag push triggers deploy).

**Usage**

```
tailor-sdk setup tag [options]
```

**Options**

| Option                        | Alias | Description                                                                  | Required | Default |
| ----------------------------- | ----- | ---------------------------------------------------------------------------- | -------- | ------- |
| `--name <NAME>`               | `-n`  | Name (defaults to the config 'name')                                         | No       | -       |
| `--tag-pattern <TAG_PATTERN>` | -     | Tag glob to match (defaults to v\*)                                          | No       | `"v*"`  |
| `--branch <BRANCH>`           | -     | Tag-reachability guard branch (no guard when omitted)                        | No       | -       |
| `--environment <ENVIRONMENT>` | -     | GitHub Environment for the plan/deploy jobs (defaults to the workspace name) | No       | -       |
| `--dir <DIR>`                 | `-d`  | App directory (for monorepo setups)                                          | No       | `"."`   |
| `--force`                     | -     | Discard hand edits / take over unmanaged files and regenerate                | No       | `false` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

## Further reading

- [GitHub Actions Integration](../github-actions.md) — usage guide: targets, generated files, secrets, approval gates, and rollback.
