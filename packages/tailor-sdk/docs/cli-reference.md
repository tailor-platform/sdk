# CLI Reference

Tailor SDK provides a command-line interface for managing projects and workspaces.

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
- `TAILOR_PLATFORM_PROFILE` - Specify profile name to use (combines user and workspace configuration)

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

- `-c, --config` - Path to the Tailor config file (default: `tailor.config.ts`)
- `-w, --watch` - Watch for type/resolver changes and regenerate

### apply

Apply Tailor configuration to deploy your application.

```bash
tailor-sdk apply [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace to apply the configuration to
- `-p, --profile` - Configuration profile to use
- `-c, --config` - Path to the Tailor config file (default: `tailor.config.ts`)
- `-d, --dryRun` - Run the command without making any changes

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

#### workspace list

List all Tailor Platform workspaces.

```bash
tailor-sdk workspace list [options]
```

**Options:**

- `-f, --format` - Output format: `table` or `json` (default: `table`)

#### workspace destroy

Destroy a Tailor Platform workspace.

```bash
tailor-sdk workspace destroy [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace to destroy (required)

### profile

Manage Tailor Platform profiles (user + workspace combinations).

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

**Options:**

- `-f, --format` - Output format: `table` or `json` (default: `table`)

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

**Options:**

- `-f, --format` - Output format: `table` or `json` (default: `table`)
