# Data Commands

Commands for managing application data across workspaces.

## data

Manage application data across workspaces.

**Usage**

```
tailor data <command>
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                     | Description                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`data clone`](#data-clone) | Clone the data of an application (TailorDB namespaces registered in its subgraph) from one workspace to another. |

### data clone

Clone the data of an application (TailorDB namespaces registered in its subgraph) from one workspace to another.

**Usage**

```
tailor data clone [options]
```

**Options**

| Option                | Alias | Description                                                        | Required | Default | Env                       |
| --------------------- | ----- | ------------------------------------------------------------------ | -------- | ------- | ------------------------- |
| `--yes`               | `-y`  | Skip confirmation prompts                                          | No       | `false` | -                         |
| `--profile <PROFILE>` | `-p`  | Workspace profile                                                  | No       | -       | `TAILOR_PLATFORM_PROFILE` |
| `--from <FROM>`       | -     | Workspace ID to copy data from                                     | Yes      | -       | -                         |
| `--to <TO>`           | -     | Workspace ID to copy data to                                       | Yes      | -       | -                         |
| `--name <NAME>`       | `-n`  | Application name (the same in the source and the target workspace) | Yes      | -       | -                         |
| `--copy-files`        | -     | Also copy TailorDB file content                                    | No       | `false` | -                         |
| `--copy-idp-users`    | -     | Also copy IdP users, including their passwords                     | No       | `false` | -                         |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.
