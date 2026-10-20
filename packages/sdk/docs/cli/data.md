---
description: "Clone application data from one workspace to another and inspect asynchronous data operations with the tailor CLI."
---

# Data Commands

Commands for managing application data across workspaces.

For prerequisites and a step-by-step walkthrough, see [Cloning Application Data](../data-clone.md).

## data

Manage application data across workspaces.

**Usage**

```
tailor data <command>
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                             | Description                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [`data clone`](#data-clone)         | Clone the data of an application (TailorDB namespaces registered in its subgraph) from one workspace to another. |
| [`data operation`](#data-operation) | Inspect asynchronous application data operations.                                                                |

### data clone

Clone the data of an application (TailorDB namespaces registered in its subgraph) from one workspace to another.

**Usage**

```
tailor data clone [options]
```

**Options**

| Option                | Alias | Description                                                                                              | Required | Default              | Env                       |
| --------------------- | ----- | -------------------------------------------------------------------------------------------------------- | -------- | -------------------- | ------------------------- |
| `--yes`               | `-y`  | Skip confirmation prompts                                                                                | No       | `false`              | -                         |
| `--profile <PROFILE>` | `-p`  | Workspace profile                                                                                        | No       | -                    | `TAILOR_PLATFORM_PROFILE` |
| `--from <FROM>`       | -     | Workspace ID to copy data from                                                                           | Yes      | -                    | -                         |
| `--to <TO>`           | -     | Workspace ID to copy data to                                                                             | Yes      | -                    | -                         |
| `--name <NAME>`       | `-n`  | Application name, the same in the source and the target workspace (default: the name in the config file) | No       | -                    | -                         |
| `--config <CONFIG>`   | `-c`  | Path to Tailor config file                                                                               | No       | `"tailor.config.ts"` | `TAILOR_CONFIG_PATH`      |
| `--copy-files`        | -     | Also copy TailorDB file content                                                                          | No       | `false`              | -                         |
| `--copy-idp-users`    | -     | Also copy IdP users, including their passwords                                                           | No       | `false`              | -                         |
| `--no-wait`           | -     | Start the clone and exit without waiting for it to finish                                                | No       | `false`              | -                         |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Notes**

The platform rejects the clone with a failed precondition unless all of the following hold:

- The source and target workspaces are in the same region.
- The target workspace has the same namespaces as the source.
- The TailorDB schema of the target matches the source, so deploy the same version to the target first.
- The target is empty for every namespace and copy type in scope (TailorDB records, plus files and IdP users when `--copy-files` / `--copy-idp-users` are given).

The command waits until the clone finishes. Pressing Ctrl+C or passing --no-wait does not stop the clone, which keeps running on the platform. Use `tailor data operation get --wait` with the operation ID printed at the start to keep waiting, or without --wait to check the status once.

With --json, the result carries `status`: `completed` once the clone has finished, or `started` with --no-wait.

### data operation

Inspect asynchronous application data operations.

**Usage**

```
tailor data operation <command>
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                     | Description                                                |
| ------------------------------------------- | ---------------------------------------------------------- |
| [`data operation get`](#data-operation-get) | Show the status of a data clone, or wait for it to finish. |

#### data operation get

Show the status of a data clone, or wait for it to finish.

**Usage**

```
tailor data operation get [options]
```

**Options**

| Option                          | Alias | Description                                 | Required | Default | Env                       |
| ------------------------------- | ----- | ------------------------------------------- | -------- | ------- | ------------------------- |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                           | No       | -       | `TAILOR_PLATFORM_PROFILE` |
| `--from <FROM>`                 | -     | Workspace ID to copy data from              | Yes      | -       | -                         |
| `--to <TO>`                     | -     | Workspace ID to copy data to                | Yes      | -       | -                         |
| `--operation-id <OPERATION_ID>` | -     | Operation ID printed when the clone started | Yes      | -       | -                         |
| `--wait`                        | -     | Wait until the clone completes or fails     | No       | `false` | -                         |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Notes**

Without --wait, the command prints the current status once and exits. With --wait, it waits until the clone completes or fails, and exits with an error if it fails. Pressing Ctrl+C stops waiting; the clone keeps running on the platform.
