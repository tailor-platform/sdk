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
- `--no-schema-check` - Skip schema diff check against migration snapshots

**Migration Handling:**

When migrations are configured (`db.tailordb.migration` in config), the `apply` command automatically:

1. Detects pending migration scripts that haven't been executed
2. Applies schema changes in a safe order (pre-migration → script execution → post-migration)
3. Executes migration scripts via TestExecScript API
4. Updates migration state labels in TailorDB metadata

See [TailorDB Commands](./tailordb.md#automatic-migration-execution) for details on automatic migration execution.

**Schema Check:**

By default, `apply` verifies that local schema changes match the migration files. This ensures migrations are properly generated before deployment. Use `--no-schema-check` to skip this verification (not recommended for production).

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
