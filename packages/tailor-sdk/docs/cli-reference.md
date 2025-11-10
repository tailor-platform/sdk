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

Initialize a new project using create-tailor-sdk.

```bash
tailor-sdk init [name] [options]
```

**Arguments:**

- `name` - Project name

**Options:**

- `--template` - Template name

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
- `--organization-id` - Organization ID to associate the workspace with
- `--folder-id` - Folder ID to associate the workspace with
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
