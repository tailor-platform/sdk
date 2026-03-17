# Secret Commands

Commands for managing Secret Manager vaults and secrets.

<!-- politty:command:secret:heading:start -->

## secret

<!-- politty:command:secret:heading:end -->

<!-- politty:command:secret:description:start -->

Manage Secret Manager vaults and secrets.

<!-- politty:command:secret:description:end -->

<!-- politty:command:secret:usage:start -->

**Usage**

```
tailor-sdk secret [command]
```

<!-- politty:command:secret:usage:end -->

<!-- politty:command:secret:subcommands:start -->

**Commands**

| Command                           | Description                   |
| --------------------------------- | ----------------------------- |
| [`secret create`](#secret-create) | Create a secret in a vault.   |
| [`secret delete`](#secret-delete) | Delete a secret in a vault.   |
| [`secret list`](#secret-list)     | List all secrets in a vault.  |
| [`secret update`](#secret-update) | Update a secret in a vault.   |
| [`secret vault`](#secret-vault)   | Manage Secret Manager vaults. |

<!-- politty:command:secret:subcommands:end -->

<!-- politty:command:secret:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:secret:global-options-link:end -->
<!-- politty:command:secret vault:heading:start -->

### secret vault

<!-- politty:command:secret vault:heading:end -->

<!-- politty:command:secret vault:description:start -->

Manage Secret Manager vaults.

<!-- politty:command:secret vault:description:end -->

<!-- politty:command:secret vault:usage:start -->

**Usage**

```
tailor-sdk secret vault [command]
```

<!-- politty:command:secret vault:usage:end -->

<!-- politty:command:secret vault:subcommands:start -->

**Commands**

| Command                                       | Description                                      |
| --------------------------------------------- | ------------------------------------------------ |
| [`secret vault create`](#secret-vault-create) | Create a new Secret Manager vault.               |
| [`secret vault delete`](#secret-vault-delete) | Delete a Secret Manager vault.                   |
| [`secret vault list`](#secret-vault-list)     | List all Secret Manager vaults in the workspace. |

<!-- politty:command:secret vault:subcommands:end -->

<!-- politty:command:secret vault:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:secret vault:global-options-link:end -->
<!-- politty:command:secret vault create:heading:start -->

#### secret vault create

<!-- politty:command:secret vault create:heading:end -->

<!-- politty:command:secret vault create:description:start -->

Create a new Secret Manager vault.

<!-- politty:command:secret vault create:description:end -->

<!-- politty:command:secret vault create:usage:start -->

**Usage**

```
tailor-sdk secret vault create [options] <name>
```

<!-- politty:command:secret vault create:usage:end -->

<!-- politty:command:secret vault create:arguments:start -->

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Vault name  | Yes      |

<!-- politty:command:secret vault create:arguments:end -->

<!-- politty:command:secret vault create:options:start -->

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

<!-- politty:command:secret vault create:options:end -->

<!-- politty:command:secret vault create:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:secret vault create:global-options-link:end -->
<!-- politty:command:secret vault delete:heading:start -->

#### secret vault delete

<!-- politty:command:secret vault delete:heading:end -->

<!-- politty:command:secret vault delete:description:start -->

Delete a Secret Manager vault.

<!-- politty:command:secret vault delete:description:end -->

<!-- politty:command:secret vault delete:usage:start -->

**Usage**

```
tailor-sdk secret vault delete [options] <name>
```

<!-- politty:command:secret vault delete:usage:end -->

<!-- politty:command:secret vault delete:arguments:start -->

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Vault name  | Yes      |

<!-- politty:command:secret vault delete:arguments:end -->

<!-- politty:command:secret vault delete:options:start -->

**Options**

| Option                          | Alias | Description               | Required | Default | Env                            |
| ------------------------------- | ----- | ------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile         | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--yes`                         | `-y`  | Skip confirmation prompts | No       | `false` | -                              |

<!-- politty:command:secret vault delete:options:end -->

<!-- politty:command:secret vault delete:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:secret vault delete:global-options-link:end -->
<!-- politty:command:secret vault list:heading:start -->

#### secret vault list

<!-- politty:command:secret vault list:heading:end -->

<!-- politty:command:secret vault list:description:start -->

List all Secret Manager vaults in the workspace.

<!-- politty:command:secret vault list:description:end -->

<!-- politty:command:secret vault list:usage:start -->

**Usage**

```
tailor-sdk secret vault list [options]
```

<!-- politty:command:secret vault list:usage:end -->

<!-- politty:command:secret vault list:options:start -->

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

<!-- politty:command:secret vault list:options:end -->

<!-- politty:command:secret vault list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:secret vault list:global-options-link:end -->
<!-- politty:command:secret create:heading:start -->

### secret create

<!-- politty:command:secret create:heading:end -->

<!-- politty:command:secret create:description:start -->

Create a secret in a vault.

<!-- politty:command:secret create:description:end -->

<!-- politty:command:secret create:usage:start -->

**Usage**

```
tailor-sdk secret create [options]
```

<!-- politty:command:secret create:usage:end -->

<!-- politty:command:secret create:options:start -->

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--vault-name <VAULT_NAME>`     | `-V`  | Vault name        | Yes      | -       | -                              |
| `--name <NAME>`                 | `-n`  | Secret name       | Yes      | -       | -                              |
| `--value <VALUE>`               | `-v`  | Secret value      | Yes      | -       | -                              |

<!-- politty:command:secret create:options:end -->

<!-- politty:command:secret create:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:secret create:global-options-link:end -->
<!-- politty:command:secret update:heading:start -->

### secret update

<!-- politty:command:secret update:heading:end -->

<!-- politty:command:secret update:description:start -->

Update a secret in a vault.

<!-- politty:command:secret update:description:end -->

<!-- politty:command:secret update:usage:start -->

**Usage**

```
tailor-sdk secret update [options]
```

<!-- politty:command:secret update:usage:end -->

<!-- politty:command:secret update:options:start -->

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--vault-name <VAULT_NAME>`     | `-V`  | Vault name        | Yes      | -       | -                              |
| `--name <NAME>`                 | `-n`  | Secret name       | Yes      | -       | -                              |
| `--value <VALUE>`               | `-v`  | Secret value      | Yes      | -       | -                              |

<!-- politty:command:secret update:options:end -->

<!-- politty:command:secret update:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:secret update:global-options-link:end -->
<!-- politty:command:secret list:heading:start -->

### secret list

<!-- politty:command:secret list:heading:end -->

<!-- politty:command:secret list:description:start -->

List all secrets in a vault.

<!-- politty:command:secret list:description:end -->

<!-- politty:command:secret list:usage:start -->

**Usage**

```
tailor-sdk secret list [options]
```

<!-- politty:command:secret list:usage:end -->

<!-- politty:command:secret list:options:start -->

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--vault-name <VAULT_NAME>`     | `-V`  | Vault name        | Yes      | -       | -                              |

<!-- politty:command:secret list:options:end -->

<!-- politty:command:secret list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:secret list:global-options-link:end -->
<!-- politty:command:secret delete:heading:start -->

### secret delete

<!-- politty:command:secret delete:heading:end -->

<!-- politty:command:secret delete:description:start -->

Delete a secret in a vault.

<!-- politty:command:secret delete:description:end -->

<!-- politty:command:secret delete:usage:start -->

**Usage**

```
tailor-sdk secret delete [options]
```

<!-- politty:command:secret delete:usage:end -->

<!-- politty:command:secret delete:options:start -->

**Options**

| Option                          | Alias | Description               | Required | Default | Env                            |
| ------------------------------- | ----- | ------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile         | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--vault-name <VAULT_NAME>`     | `-V`  | Vault name                | Yes      | -       | -                              |
| `--name <NAME>`                 | `-n`  | Secret name               | Yes      | -       | -                              |
| `--yes`                         | `-y`  | Skip confirmation prompts | No       | `false` | -                              |

<!-- politty:command:secret delete:options:end -->

<!-- politty:command:secret delete:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:secret delete:global-options-link:end -->
