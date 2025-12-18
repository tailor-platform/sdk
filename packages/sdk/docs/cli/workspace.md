# Workspace Commands

Commands for managing workspaces and profiles.

## workspace

Manage Tailor Platform workspaces.

```bash
tailor-sdk workspace <subcommand> [options]
```

### workspace create

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
- `-j, --json` - Output as JSON

### workspace list

List all Tailor Platform workspaces.

```bash
tailor-sdk workspace list [options]
```

**Options:**

- `-j, --json` - Output as JSON
- `-l, --limit <number>` - Maximum number of workspaces to list (positive integer)

### workspace delete

Delete a Tailor Platform workspace.

```bash
tailor-sdk workspace delete [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace to delete (required)
- `-y, --yes` - Skip confirmation prompt

## profile

Manage workspace profiles (user + workspace combinations).

```bash
tailor-sdk profile <subcommand> [options]
```

### profile create

Create a new profile.

```bash
tailor-sdk profile create <name> [options]
```

**Arguments:**

- `name` - Profile name (required)

**Options:**

- `-u, --user` - User email (required)
- `-w, --workspace-id` - Workspace ID (required)
- `-j, --json` - Output as JSON

### profile list

List all profiles.

```bash
tailor-sdk profile list [options]
```

**Options:**

- `-j, --json` - Output as JSON

### profile update

Update profile properties.

```bash
tailor-sdk profile update <name> [options]
```

**Arguments:**

- `name` - Profile name (required)

**Options:**

- `-u, --user` - New user email
- `-w, --workspace-id` - New workspace ID
- `-j, --json` - Output as JSON

### profile delete

Delete a profile.

```bash
tailor-sdk profile delete <name>
```

**Arguments:**

- `name` - Profile name (required)
