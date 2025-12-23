# Secret Commands

Commands for managing Secret Manager vaults and secrets.

## secret

Manage Secret Manager vaults and secrets.

```bash
tailor-sdk secret <subcommand> [options]
```

### secret vault

Manage Secret Manager vaults.

```bash
tailor-sdk secret vault <subcommand> [options]
```

#### secret vault create

Create a new Secret Manager vault.

```bash
tailor-sdk secret vault create <name> [options]
```

**Arguments:**

- `name` - Vault name (required)

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use

#### secret vault delete

Delete a Secret Manager vault.

```bash
tailor-sdk secret vault delete <name> [options]
```

**Arguments:**

- `name` - Vault name (required)

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-y, --yes` - Skip confirmation prompt

#### secret vault list

List all Secret Manager vaults in the workspace.

```bash
tailor-sdk secret vault list [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-j, --json` - Output as JSON

### secret create

Create a secret in a vault.

```bash
tailor-sdk secret create [options]
```

**Options:**

- `-V, --vault-name` - Vault name (required)
- `-n, --name` - Secret name (required)
- `-v, --value` - Secret value (required)
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use

### secret update

Update a secret in a vault.

```bash
tailor-sdk secret update [options]
```

**Options:**

- `-V, --vault-name` - Vault name (required)
- `-n, --name` - Secret name (required)
- `-v, --value` - New secret value (required)
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use

### secret list

List all secrets in a vault.

```bash
tailor-sdk secret list [options]
```

**Options:**

- `-V, --vault-name` - Vault name (required)
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-j, --json` - Output as JSON

### secret delete

Delete a secret in a vault.

```bash
tailor-sdk secret delete [options]
```

**Options:**

- `-V, --vault-name` - Vault name (required)
- `-n, --name` - Secret name (required)
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-y, --yes` - Skip confirmation prompt
