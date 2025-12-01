# CLI Reference

The Tailor Platform SDK provides a command-line interface for managing projects and workspaces.

## Usage

```bash
tailor-sdk <command> [options]
```

## Common Options

The following options are available for most commands:

- `-e, --env-file` - Specify a custom environment file path
- `-v, --verbose` - Enable detailed logging output

## Environment Variables

You can use environment variables to configure workspace and authentication:

- `TAILOR_PLATFORM_WORKSPACE_ID` - Specify workspace ID for the `apply` command
- `TAILOR_PLATFORM_TOKEN` - Specify authentication token (alternative to using `login`)
- `TAILOR_PLATFORM_PROFILE` - Specify workspace profile name to use (combines user and workspace configuration)
- `TAILOR_PLATFORM_SDK_CONFIG_PATH` - Specify path to the SDK config file (alternative to using `--config` option)

## Commands

### init

Initialize a new project using create-sdk.

```bash
tailor-sdk init [name] [options]
```

**Arguments:**

- `name` - Project name

**Options:**

- `-t, --template` - Template name

### generate

Generate files using Tailor configuration.

```bash
tailor-sdk generate [options]
```

**Options:**

- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-w, --watch` - Watch for type/resolver changes and regenerate

### apply

Apply Tailor configuration to deploy your application.

```bash
tailor-sdk apply [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace to apply the configuration to
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-d, --dryRun` - Run the command without making any changes
- `-y, --yes` - Skip confirmation prompt

### remove

Remove all resources managed by the application from the workspace.

```bash
tailor-sdk remove [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace to remove resources from
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-y, --yes` - Skip confirmation prompt

### show

Show information about the deployed application.

```bash
tailor-sdk show [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace to show the application from
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-f, --format` - Output format: `table` or `json` (default: `table`)

### login

Login to Tailor Platform.

```bash
tailor-sdk login
```

### logout

Logout from Tailor Platform.

```bash
tailor-sdk logout
```

### workspace

Manage Tailor Platform workspaces.

```bash
tailor-sdk workspace <subcommand> [options]
```

#### workspace create

Create a new Tailor Platform workspace.

```bash
tailor-sdk workspace create [options]
```

**Options:**

- `-n, --name` - Name of the workspace (required)
- `-r, --region` - Region of the workspace: `us-west` or `asia-northeast` (required)
- `-d, --delete-protection` - Enable delete protection for the workspace
- `-o, --organization-id` - Organization ID to associate the workspace with
- `-f, --folder-id` - Folder ID to associate the workspace with
- `-f, --format` - Output format: `table` or `json` (default: `table`)

#### workspace list

List all Tailor Platform workspaces.

```bash
tailor-sdk workspace list [options]
```

**Options:**

- `-f, --format` - Output format: `table` or `json` (default: `table`)

#### workspace delete

Delete a Tailor Platform workspace.

```bash
tailor-sdk workspace delete [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace to delete (required)
- `-y, --yes` - Skip confirmation prompt

### profile

Manage workspace profiles (user + workspace combinations).

```bash
tailor-sdk profile <subcommand> [options]
```

#### profile create

Create a new profile.

```bash
tailor-sdk profile create <name> [options]
```

**Arguments:**

- `name` - Profile name (required)

**Options:**

- `-u, --user` - User email (required)
- `-w, --workspace-id` - Workspace ID (required)
- `-f, --format` - Output format: `table` or `json` (default: `table`)

#### profile list

List all profiles.

```bash
tailor-sdk profile list [options]
```

**Options:**

- `-f, --format` - Output format: `table` or `json` (default: `table`)

#### profile update

Update profile properties.

```bash
tailor-sdk profile update <name> [options]
```

**Arguments:**

- `name` - Profile name (required)

**Options:**

- `-u, --user` - New user email
- `-w, --workspace-id` - New workspace ID
- `-f, --format` - Output format: `table` or `json` (default: `table`)

#### profile delete

Delete a profile.

```bash
tailor-sdk profile delete <name>
```

**Arguments:**

- `name` - Profile name (required)

### user

Manage Tailor Platform users.

```bash
tailor-sdk user <subcommand> [options]
```

#### user current

Show current user.

```bash
tailor-sdk user current [options]
```

#### user list

List all users.

```bash
tailor-sdk user list [options]
```

**Options:**

- `-f, --format` - Output format: `table` or `json` (default: `table`)

#### user use

Set current user.

```bash
tailor-sdk user use <user>
```

**Arguments:**

- `user` - User email (required)

#### user pat

Manage personal access tokens.

```bash
tailor-sdk user pat <subcommand> [options]
```

When no subcommand is provided, defaults to `list`.

##### user pat list

List all personal access tokens.

```bash
tailor-sdk user pat list [options]
```

**Options:**

- `-f, --format` - Output format: `text` or `json` (default: `text`)

**Output (default):**

```
 token-name-1: read/write
 token-name-2: read
```

**Output (`--format json`):**

```json
[
  { "name": "token-name-1", "scopes": ["read", "write"] },
  { "name": "token-name-2", "scopes": ["read"] }
]
```

##### user pat create

Create a new personal access token.

```bash
tailor-sdk user pat create <name> [options]
```

**Arguments:**

- `name` - Token name (required)

**Options:**

- `-w, --write` - Grant write permission (default: read-only)
- `-f, --format` - Output format: `text` or `json` (default: `text`)

**Output (default):**

```
Personal access token created successfully.

  name: token-name
scopes: read/write
 token: tpp_xxxxxxxxxxxxx

Please save this token in a secure location. You won't be able to see it again.
```

**Output (`--format json`):**

```json
{ "name": "token-name", "scopes": ["read", "write"], "token": "eyJhbGc..." }
```

##### user pat delete

Delete a personal access token.

```bash
tailor-sdk user pat delete <name>
```

**Arguments:**

- `name` - Token name (required)

##### user pat update

Update a personal access token (delete and recreate).

```bash
tailor-sdk user pat update <name> [options]
```

**Arguments:**

- `name` - Token name (required)

**Options:**

- `-w, --write` - Grant write permission (if not specified, keeps read-only)
- `-f, --format` - Output format: `text` or `json` (default: `text`)

**Output (default):**

```
Personal access token updated successfully.

  name: token-name
scopes: read/write
 token: tpp_xxxxxxxxxxxxx

Please save this token in a secure location. You won't be able to see it again.
```

**Output (`--format json`):**

```json
{
  "name": "token-name",
  "scopes": ["read", "write"],
  "token": "tpp_xxxxxxxxxxxxx"
}
```

### tailordb

Manage TailorDB tables and data.

```bash
tailor-sdk tailordb <subcommand> [options]
```

#### tailordb truncate

Truncate (delete all records from) TailorDB tables.

```bash
tailor-sdk tailordb truncate [types...] [options]
```

**Arguments:**

- `types...` - Space-separated list of type names to truncate (optional)

**Options:**

- `-a, --all` - Truncate all tables in all namespaces
- `-n, --namespace` - Truncate all tables in the specified namespace
- `-y, --yes` - Skip confirmation prompt
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)

**Usage Examples:**

```bash
# Truncate all tables in all namespaces (requires confirmation)
tailor-sdk tailordb truncate --all

# Truncate all tables in all namespaces (skip confirmation)
tailor-sdk tailordb truncate --all --yes

# Truncate all tables in a specific namespace
tailor-sdk tailordb truncate --namespace myNamespace

# Truncate specific types (namespace is auto-detected)
tailor-sdk tailordb truncate User Post Comment

# Truncate specific types with confirmation skipped
tailor-sdk tailordb truncate User Post --yes
```

**Notes:**

- You must specify exactly one of: `--all`, `--namespace`, or type names
- When truncating specific types, the namespace is automatically detected from your config
- Confirmation prompts vary based on the operation:
  - `--all`: requires typing `truncate all`
  - `--namespace`: requires typing `truncate <namespace-name>`
  - Specific types: requires typing `yes`
- Use `--yes` flag to skip confirmation prompts (useful for scripts and CI/CD)

### machineuser

Manage machine users in your Tailor Platform application.

```bash
tailor-sdk machineuser <subcommand> [options]
```

#### machineuser list

List all machine users in the application.

```bash
tailor-sdk machineuser list [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-f, --format` - Output format: `table` or `json` (default: `table`)

#### machineuser token

Get an access token for a machine user.

```bash
tailor-sdk machineuser token <name> [options]
```

**Arguments:**

- `name` - Machine user name (required)

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-f, --format` - Output format: `table` or `json` (default: `table`)

### oauth2client

Manage OAuth2 clients in your Tailor Platform application.

```bash
tailor-sdk oauth2client <subcommand> [options]
```

#### oauth2client list

List all OAuth2 clients in the application.

```bash
tailor-sdk oauth2client list [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-f, --format` - Output format: `table` or `json` (default: `table`)

**Output:**

Returns a list of OAuth2 clients with the following fields:

- `name` - Client name
- `description` - Client description
- `clientId` - OAuth2 client ID
- `grantTypes` - Supported grant types (e.g., `authorization_code`, `refresh_token`)
- `redirectUris` - Registered redirect URIs
- `createdAt` - Creation timestamp

#### oauth2client get

Get OAuth2 client credentials (including client secret).

```bash
tailor-sdk oauth2client get <name> [options]
```

**Arguments:**

- `name` - OAuth2 client name (required)

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-f, --format` - Output format: `table` or `json` (default: `table`)

**Output:**

Returns the OAuth2 client credentials with the following fields:

- `name` - Client name
- `description` - Client description
- `clientId` - OAuth2 client ID
- `clientSecret` - OAuth2 client secret
- `grantTypes` - Supported grant types
- `redirectUris` - Registered redirect URIs
- `createdAt` - Creation timestamp

### secret

Manage Secret Manager vaults and secrets.

```bash
tailor-sdk secret <subcommand> [options]
```

#### secret vault

Manage Secret Manager vaults.

```bash
tailor-sdk secret vault <subcommand> [options]
```

##### secret vault create

Create a new Secret Manager vault.

```bash
tailor-sdk secret vault create [options]
```

**Options:**

- `-n, --name` - Vault name (required)
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use

##### secret vault delete

Delete a Secret Manager vault.

```bash
tailor-sdk secret vault delete [options]
```

**Options:**

- `-n, --name` - Vault name (required)
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use

##### secret vault list

List all Secret Manager vaults in the workspace.

```bash
tailor-sdk secret vault list [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-f, --format` - Output format: `table` or `json` (default: `table`)

#### secret create

Create a secret in a vault.

```bash
tailor-sdk secret create [options]
```

**Options:**

- `--vault-name` - Vault name (required)
- `-n, --name` - Secret name (required)
- `-v, --value` - Secret value (required)
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use

#### secret update

Update a secret in a vault.

```bash
tailor-sdk secret update [options]
```

**Options:**

- `--vault-name` - Vault name (required)
- `-n, --name` - Secret name (required)
- `-v, --value` - New secret value (required)
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use

#### secret list

List all secrets in a vault.

```bash
tailor-sdk secret list [options]
```

**Options:**

- `--vault-name` - Vault name (required)
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-f, --format` - Output format: `table` or `json` (default: `table`)

#### secret delete

Delete a secret in a vault.

```bash
tailor-sdk secret delete [options]
```

**Options:**

- `--vault-name` - Vault name (required)
- `-n, --name` - Secret name (required)
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
