# Application Commands

Commands for managing Tailor Platform applications. These commands work with `tailor.config.ts`.

## init

Initialize a new project using create-sdk.

```bash
tailor-sdk init [name] [options]
```

**Arguments:**

- `name` - Project name

**Options:**

- `-t, --template` - Template name

## generate

Generate files using Tailor configuration.

```bash
tailor-sdk generate [options]
```

**Options:**

- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-W, --watch` - Watch for type/resolver changes and regenerate

## apply

Apply Tailor configuration to deploy your application.

```bash
tailor-sdk apply [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace to apply the configuration to
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-d, --dry-run` - Run the command without making any changes
- `-y, --yes` - Skip confirmation prompt

## remove

Remove all resources managed by the application from the workspace.

```bash
tailor-sdk remove [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace to remove resources from
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-y, --yes` - Skip confirmation prompt

## show

Show information about the deployed application.

```bash
tailor-sdk show [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace to show the application from
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-j, --json` - Output as JSON

## tailordb

Manage TailorDB tables and data.

```bash
tailor-sdk tailordb <subcommand> [options]
```

### tailordb truncate

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

### tailordb erd (beta)

Generate ERD artifacts for TailorDB namespaces.

```bash
tailor-sdk tailordb erd <subcommand> [options]
```

**Subcommands:**

- `export` - Export Liam ERD dist from applied TailorDB schema
- `serve` - Generate and serve ERD locally (liam build + `serve dist`)
- `deploy` - Deploy ERD static website for a TailorDB namespace

**Notes:**

- This command is a beta feature and may introduce breaking changes in future releases
