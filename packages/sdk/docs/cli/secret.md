# Secret Commands

Commands for managing Secret Manager vaults and secrets.

<!-- politty:command:secret:start -->
## secret

Manage secrets and vaults

**Usage**

```
tailor-sdk secret [command]
```

**Commands**

| Command | Description |
|---------|-------------|
| [`secret create`](#secret-create) | Create a secret in a vault |
| [`secret delete`](#secret-delete) | Delete a secret in a vault |
| [`secret list`](#secret-list) | List secrets in a vault |
| [`secret update`](#secret-update) | Update a secret in a vault |
| [`secret vault`](#secret-vault) | Manage Secret Manager vaults |

<!-- politty:command:secret:end -->
<!-- politty:command:secret vault:start -->
### secret vault

Manage Secret Manager vaults

**Usage**

```
tailor-sdk secret vault [command]
```

**Commands**

| Command | Description |
|---------|-------------|
| [`secret vault create`](#secret-vault-create) | Create a Secret Manager vault |
| [`secret vault delete`](#secret-vault-delete) | Delete a Secret Manager vault |
| [`secret vault list`](#secret-vault-list) | List Secret Manager vaults |

<!-- politty:command:secret vault:end -->
<!-- politty:command:secret vault create:start -->
#### secret vault create

Create a Secret Manager vault

**Usage**

```
tailor-sdk secret vault create [options] <name>
```

**Arguments**

| Argument | Description | Required |
|----------|-------------|----------|
| `name` | Vault name | Yes |

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | - |
| `--verbose` | - | Enable verbose logging | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |

<!-- politty:command:secret vault create:end -->
<!-- politty:command:secret vault delete:start -->
#### secret vault delete

Delete a Secret Manager vault

**Usage**

```
tailor-sdk secret vault delete [options] <name>
```

**Arguments**

| Argument | Description | Required |
|----------|-------------|----------|
| `name` | Vault name | Yes |

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | - |
| `--verbose` | - | Enable verbose logging | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |
| `--yes` | `-y` | Skip confirmation prompts | `false` |

<!-- politty:command:secret vault delete:end -->
<!-- politty:command:secret vault list:start -->
#### secret vault list

List Secret Manager vaults

**Usage**

```
tailor-sdk secret vault list [options]
```

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | - |
| `--verbose` | - | Enable verbose logging | `false` |
| `--json` | `-j` | Output as JSON | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |

<!-- politty:command:secret vault list:end -->
<!-- politty:command:secret create:start -->
### secret create

Create a secret in a vault

**Usage**

```
tailor-sdk secret create [options]
```

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | - |
| `--verbose` | - | Enable verbose logging | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |
| `--vault-name <VAULT_NAME>` | `-V` | Vault name | - |
| `--name <NAME>` | `-n` | Secret name | - |
| `--value <VALUE>` | `-v` | Secret value | - |

<!-- politty:command:secret create:end -->
<!-- politty:command:secret update:start -->
### secret update

Update a secret in a vault

**Usage**

```
tailor-sdk secret update [options]
```

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | - |
| `--verbose` | - | Enable verbose logging | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |
| `--vault-name <VAULT_NAME>` | `-V` | Vault name | - |
| `--name <NAME>` | `-n` | Secret name | - |
| `--value <VALUE>` | `-v` | Secret value | - |

<!-- politty:command:secret update:end -->
<!-- politty:command:secret list:start -->
### secret list

List secrets in a vault

**Usage**

```
tailor-sdk secret list [options]
```

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | - |
| `--verbose` | - | Enable verbose logging | `false` |
| `--json` | `-j` | Output as JSON | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |
| `--vault-name <VAULT_NAME>` | `-V` | Vault name | - |

<!-- politty:command:secret list:end -->
<!-- politty:command:secret delete:start -->
### secret delete

Delete a secret in a vault

**Usage**

```
tailor-sdk secret delete [options]
```

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--env-file <ENV_FILE>` | `-e` | Path to the environment file (error if not found) | - |
| `--env-file-if-exists <ENV_FILE_IF_EXISTS>` | - | Path to the environment file (ignored if not found) | - |
| `--verbose` | - | Enable verbose logging | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |
| `--vault-name <VAULT_NAME>` | `-V` | Vault name | - |
| `--name <NAME>` | `-n` | Secret name | - |
| `--yes` | `-y` | Skip confirmation prompts | `false` |

<!-- politty:command:secret delete:end -->
