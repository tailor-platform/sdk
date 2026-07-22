# Secret Commands

Commands for managing Secret Manager vaults and secrets.

## secret

Manage Secret Manager vaults and secrets.

**Usage**

```
tailor-sdk secret [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                           | Description                   |
| --------------------------------- | ----------------------------- |
| [`secret vault`](#secret-vault)   | Manage Secret Manager vaults. |
| [`secret create`](#secret-create) | Create a secret in a vault.   |
| [`secret update`](#secret-update) | Update a secret in a vault.   |
| [`secret list`](#secret-list)     | List all secrets in a vault.  |
| [`secret delete`](#secret-delete) | Delete a secret in a vault.   |

### secret create

Create a secret in a vault.

**Usage**

```
tailor-sdk secret create [options]
```

**Options**

| Option                          | Alias | Description               | Required | Default | Env                            |
| ------------------------------- | ----- | ------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile         | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--vault-name <VAULT_NAME>`     | `-V`  | Vault name                | Yes      | -       | -                              |
| `--name <NAME>`                 | `-n`  | Secret name               | Yes      | -       | -                              |
| `--value <VALUE>`               | `-v`  | Secret value              | Yes      | -       | -                              |
| `--yes`                         | `-y`  | Skip confirmation prompts | No       | `false` | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### secret delete

Delete a secret in a vault.

**Usage**

```
tailor-sdk secret delete [options]
```

**Options**

| Option                          | Alias | Description               | Required | Default | Env                            |
| ------------------------------- | ----- | ------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile         | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--vault-name <VAULT_NAME>`     | `-V`  | Vault name                | Yes      | -       | -                              |
| `--name <NAME>`                 | `-n`  | Secret name               | Yes      | -       | -                              |
| `--yes`                         | `-y`  | Skip confirmation prompts | No       | `false` | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### secret list

List all secrets in a vault.

**Usage**

```
tailor-sdk secret list [options]
```

**Options**

| Option                          | Alias | Description                                              | Required | Default  | Env                            |
| ------------------------------- | ----- | -------------------------------------------------------- | -------- | -------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                             | No       | -        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                        | No       | -        | `TAILOR_PLATFORM_PROFILE`      |
| `--vault-name <VAULT_NAME>`     | `-V`  | Vault name                                               | Yes      | -        | -                              |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                                 | No       | `"desc"` | -                              |
| `--limit <LIMIT>`               | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### secret update

Update a secret in a vault.

**Usage**

```
tailor-sdk secret update [options]
```

**Options**

| Option                          | Alias | Description               | Required | Default | Env                            |
| ------------------------------- | ----- | ------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile         | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--vault-name <VAULT_NAME>`     | `-V`  | Vault name                | Yes      | -       | -                              |
| `--name <NAME>`                 | `-n`  | Secret name               | Yes      | -       | -                              |
| `--value <VALUE>`               | `-v`  | Secret value              | Yes      | -       | -                              |
| `--yes`                         | `-y`  | Skip confirmation prompts | No       | `false` | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### secret vault

Manage Secret Manager vaults.

**Usage**

```
tailor-sdk secret vault [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                       | Description                                      |
| --------------------------------------------- | ------------------------------------------------ |
| [`secret vault create`](#secret-vault-create) | Create a new Secret Manager vault.               |
| [`secret vault delete`](#secret-vault-delete) | Delete a Secret Manager vault.                   |
| [`secret vault list`](#secret-vault-list)     | List all Secret Manager vaults in the workspace. |

#### secret vault create

Create a new Secret Manager vault.

**Usage**

```
tailor-sdk secret vault create [options] <name>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Vault name  | Yes      |

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### secret vault delete

Delete a Secret Manager vault.

**Usage**

```
tailor-sdk secret vault delete [options] <name>
```

**Arguments**

| Argument | Description | Required |
| -------- | ----------- | -------- |
| `name`   | Vault name  | Yes      |

**Options**

| Option                          | Alias | Description               | Required | Default | Env                            |
| ------------------------------- | ----- | ------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile         | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--yes`                         | `-y`  | Skip confirmation prompts | No       | `false` | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### secret vault list

List all Secret Manager vaults in the workspace.

**Usage**

```
tailor-sdk secret vault list [options]
```

**Options**

| Option                          | Alias | Description                                              | Required | Default  | Env                            |
| ------------------------------- | ----- | -------------------------------------------------------- | -------- | -------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                             | No       | -        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                        | No       | -        | `TAILOR_PLATFORM_PROFILE`      |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                                 | No       | `"desc"` | -                              |
| `--limit <LIMIT>`               | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.
