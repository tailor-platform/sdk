# TailorDB Commands

Commands for managing TailorDB tables, data, and schema migrations.

## tailordb truncate

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

## tailordb migration

Manage TailorDB schema migrations. Migrations allow you to safely evolve your database schema with data transformations.

```bash
tailor-sdk tailordb migration <subcommand> [options]
```

### Overview

The migration system detects field-level schema differences between your local type definitions and the previous snapshot, then generates migration files to safely apply those changes with data transformations.

**Key Features:**

- **Local snapshot-based diff detection** between current types and previous migration snapshot
- **Transaction-wrapped data migrations** for atomicity - all changes commit or rollback together
- **Automatic execution during apply** - pending migrations run as part of `tailor-sdk apply`
- **TypeScript migration scripts** - type-safe data transformations using Kysely

### tailordb migration generate

Generate migration files by detecting schema differences between current local types and the previous migration snapshot.

```bash
tailor-sdk tailordb migration generate [options]
```

**Options:**

- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-n, --name` - Optional description for the migration
- `-y, --yes` - Skip confirmation prompts
- `--init` - Delete existing migrations and start fresh

**Usage Examples:**

```bash
# Generate migration for all schema changes
tailor-sdk tailordb migration generate

# Generate with a description
tailor-sdk tailordb migration generate --name "add email field to user"

# Generate without confirmation prompts
tailor-sdk tailordb migration generate --yes

# Delete existing migrations and start fresh (with confirmation)
tailor-sdk tailordb migration generate --init

# Delete existing migrations and start fresh (skip confirmation)
tailor-sdk tailordb migration generate --init --yes
```

**Generated Files:**

Each migration creates a directory in the migrations folder with a 4-digit sequential number:

| File               | Description                                        |
| ------------------ | -------------------------------------------------- |
| `0000/schema.json` | Initial schema snapshot (first migration only)     |
| `XXXX/diff.json`   | Schema diff from previous snapshot                 |
| `XXXX/migrate.ts`  | Data migration script (only when breaking changes) |
| `XXXX/db.ts`       | Generated Kysely types for the migration script    |

**Migration Script Structure:**

```typescript
import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  // Your data migration logic here
  // All operations use the transaction object (trx)
  await trx.updateTable("User").set({ newField: "default value" }).execute();
}
```

The `db.ts` file contains Kysely Transaction types that reflect the schema state **before** the migration runs. This ensures type-safe data transformations based on the actual database structure at that point in time.

The `main` function receives a Kysely transaction object. All database operations should use this `trx` object to ensure atomicity - if any operation fails, all changes are rolled back.

**Editor Integration:**

If the `EDITOR` environment variable is set, the generated script file will automatically open in your preferred editor:

```bash
export EDITOR=vim
tailor-sdk tailordb migration generate
# → After generation, vim opens XXXX/migrate.ts
```

### tailordb migration set

Manually set the migration checkpoint to a specific number. This is useful for skipping failed migrations or resetting migration state.

```bash
tailor-sdk tailordb migration set <number> [options]
```

**Arguments:**

- `number` - Migration number to set (e.g., `0001` or `1`)

**Options:**

- `-n, --namespace` - Target TailorDB namespace (required if multiple exist)
- `-y, --yes` - Skip confirmation prompt
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)

**Usage Examples:**

```bash
# Set migration checkpoint to 0001 (with confirmation)
tailor-sdk tailordb migration set 1

# Set migration checkpoint without confirmation
tailor-sdk tailordb migration set 1 --yes

# Set for specific namespace
tailor-sdk tailordb migration set 2 --namespace tailordb

# Reset to initial state (all migrations become pending)
tailor-sdk tailordb migration set 0 --yes
```

**Warning:**

Setting the migration checkpoint changes which migrations will be executed on next apply:

- **Forward** (e.g., 0001 → 0003): Skips migrations 0002 and 0003
- **Backward** (e.g., 0003 → 0001): Migrations 0002 and 0003 become pending and will re-execute

The command always displays a warning and requires confirmation unless `--yes` is specified.

### tailordb migration status

Show the current migration status for TailorDB namespaces, including applied and pending migrations.

```bash
tailor-sdk tailordb migration status [options]
```

**Options:**

- `-n, --namespace` - Show status for specific namespace only
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)

**Usage Examples:**

```bash
# Show status for all namespaces
tailor-sdk tailordb migration status

# Show status for specific namespace
tailor-sdk tailordb migration status --namespace tailordb
```

**Example Output:**

```
Namespace: tailordb
  Current migration: 0001
  Pending migrations:
    - 0002: Add email field to user
    - 0003: Remove deprecated status field
```

## Configuration

Configure migrations in `tailor.config.ts`:

```typescript
export default defineConfig({
  name: "my-app",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
      migration: {
        directory: "./migrations",
        // Optional: specify machine user for migration script execution
        // If not specified, the first machine user from auth.machineUsers is used
        machineUser: "admin-machine-user",
      },
    },
  },
});
```

### Configuration Options

| Option                  | Type     | Description                                                                                                        |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `files`                 | string[] | Glob patterns for TailorDB type definition files                                                                   |
| `ignores`               | string[] | Glob patterns to ignore                                                                                            |
| `migration.directory`   | string   | Directory path for migration files                                                                                 |
| `migration.machineUser` | string   | Machine user name for migration script execution (optional, defaults to first machine user from auth.machineUsers) |

### Machine User Selection

When executing migration scripts, the system selects a machine user in the following priority:

1. **Explicit configuration**: `migration.machineUser` in db config
2. **Auto-selection**: First machine user from `auth.machineUsers`

The machine user being used is logged during migration execution.

## Migration Directory Structure

Migrations use a directory-based structure with 4-digit sequential numbering:

```
migrations/
├── 0000/                    # Initial schema (number 0)
│   └── schema.json          # Full schema snapshot
├── 0001/                    # First change
│   ├── diff.json            # Schema diff
│   ├── migrate.ts           # Migration script (if breaking changes)
│   └── db.ts                # Kysely types (if breaking changes)
├── 0002/                    # Second change
│   └── diff.json
└── ...
```

- `0000` - Initial schema snapshot (always starts at 0)
- `0001` - First schema change
- `0002` - Second schema change, etc.

## Supported Schema Changes

| Change Type                     | Breaking? | Migration Script | Notes                                         |
| ------------------------------- | --------- | ---------------- | --------------------------------------------- |
| Add optional field              | No        | No               | Schema change only                            |
| Add required field              | Yes       | Yes              | Script populates default values               |
| Remove field                    | No        | No               | Schema change only - data is preserved        |
| Change optional→required        | Yes       | Yes              | Script sets defaults for null values          |
| Change required→optional        | No        | No               | Schema change only                            |
| Add index                       | No        | No               | Schema change only                            |
| Remove index                    | No        | No               | Schema change only                            |
| Add unique constraint           | Yes       | Yes              | Script must resolve duplicate values          |
| Remove unique constraint        | No        | No               | Schema change only                            |
| Add enum value                  | No        | No               | Schema change only                            |
| Remove enum value               | Yes       | Yes              | Script migrates records with removed values   |
| Add type                        | No        | No               | Schema change only                            |
| Remove type                     | No        | No               | Schema change only - data is preserved        |
| Change field type               | -         | -                | **Not supported** - requires 3-step migration |
| Change array to single value    | -         | -                | **Not supported** - requires 3-step migration |
| Change single value to array    | -         | -                | **Not supported** - requires 3-step migration |
| Change foreign key relationship | Yes       | Yes              | Script updates existing references            |

### Unsupported Schema Changes

The following changes require a 3-step migration process:

#### Field Type Change

Field type changes (e.g., `string` → `integer`) are not directly supported. Use this migration strategy:

1. **Migration 1**: Add a new field with the desired type (e.g., `fieldName_new`) and migrate data
2. **Migration 2**: Remove the old field
3. **Migration 3**: Add the field with the original name and new type, migrate data from temporary field, then remove temporary field

#### Array Property Change

Changing between single value and array (e.g., `array: false` → `array: true`) is not directly supported. Use the same 3-step migration strategy as field type changes.

## Example Workflow

1. **Modify your type definition:**

   ```typescript
   // tailordb/user.ts
   export const user = db.type("User", {
     name: db.string(),
     email: db.string(), // ← New required field
     ...db.fields.timestamps(),
   });
   ```

2. **Generate migration:**

   ```bash
   tailor-sdk tailordb migration generate
   # Output: Generated migration 0001
   #   Diff file: ./migrations/0001/diff.json
   #   Migration script: ./migrations/0001/migrate.ts
   #   DB types: ./migrations/0001/db.ts
   ```

3. **Edit the migration script** (`0001/migrate.ts`):

   ```typescript
   import type { Transaction } from "./db";

   export async function main(trx: Transaction): Promise<void> {
     await trx
       .updateTable("User")
       .set({ email: "default@example.com" })
       .where("email", "is", null)
       .execute();
   }
   ```

4. **Apply migration:**
   ```bash
   tailor-sdk apply
   # Migrations are automatically executed during apply
   ```

## Automatic Migration Execution

When running `tailor-sdk apply`, pending migration scripts are automatically executed as part of the deployment process.

### How It Works

1. **Pending Migration Detection**: Identifies migration scripts that haven't been executed yet
2. **Two-Stage Type Update**: For breaking changes (required fields, type changes):
   - **Pre-Migration**: New fields are added as `optional` first
   - **Script Execution**: Migration scripts run to populate data
   - **Post-Migration**: Fields are changed to `required`, deletions are applied

### Execution Flow

```
tailor-sdk apply
    │
    ├── Detect Pending Migrations
    │
    ├── [If pending migrations exist]
    │   ├── Pre-Migration: Add fields as optional
    │   ├── Execute Migration Scripts (TestExecScript API)
    │   └── Post-Migration: Apply required, deletions
    │
    └── Continue with normal apply flow
```

### Requirements for Automatic Migration

1. **Migrations configured**: `migrations` path set in db config
2. **Auth configured**: Auth service with machine users
3. **Kysely generator**: `@tailor-platform/kysely-type` generator configured

### Schema Verification

By default, `tailor-sdk apply` performs two schema verifications:

1. **Local schema check**: Ensures local type definitions match the migration snapshot
2. **Remote schema check**: Ensures remote schema matches the expected state based on migration history

If remote schema drift is detected, you'll see an error like:

```
✖ Remote schema drift detected:
Namespace: tailordb
  Remote migration: 0007
  Differences:
  Type 'User':
    - Field 'email': required: remote=false, expected=true

ℹ This may indicate:
  - Another developer applied different migrations
  - Manual schema changes were made directly
  - Migration history is out of sync

ℹ Use '--no-schema-check' to skip this check (not recommended).
```

### Skipping Schema Check

To skip both local and remote schema verification (not recommended for production):

```bash
tailor-sdk apply --no-schema-check
```

**Warning:** Skipping schema checks may result in applying migrations to an inconsistent state.

### Example Output

```
ℹ Found 2 pending migration(s) to execute.
ℹ Executing 2 pending migration(s)...
ℹ Using machine user: admin-machine-user

✔ Migration tailordb/0002 completed successfully
✔ Migration tailordb/0003 completed successfully

✔ All migrations completed successfully.
✔ Successfully applied changes.
```

## Troubleshooting

### Remote schema drift detected

**Cause:** The remote schema doesn't match the expected state based on migration history. This can happen when:

- Another developer applied different migrations
- Schema was changed manually outside of migrations
- Migration history is out of sync

**Solution:**

1. **Check migration status**: Run `tailor-sdk tailordb migration status` to see current state
2. **Sync with team**: Ensure all team members have the same migration files
3. **Reset if needed**: Use `tailor-sdk tailordb migration set <number>` to reset migration checkpoint
4. **Force apply** (use with caution): Use `--no-schema-check` to skip verification

### "Machine user not found"

**Cause:** Specified machine user doesn't exist in auth configuration.

**Solution:**

1. Check available users: The error message lists available machine users
2. Add machine user to your auth config:
   ```typescript
   machineUsers: {
     "your-user-name": {
       attributes: { role: "ADMIN" },
     },
   }
   ```
3. Run `tailor-sdk apply` to deploy the auth config
4. Retry migration

### Migration script execution fails

**Cause:** Runtime error in your data migration logic.

**Solution:**

1. Check the error message for the failing query/operation
2. Test your script logic locally if possible
3. Fix the script
4. Apply again: `tailor-sdk apply`

## tailordb erd (beta)

Generate ERD artifacts for TailorDB namespaces using [Liam ERD](https://liambx.com/erd).

```bash
tailor-sdk tailordb erd <subcommand> [options]
```

**Notes:**

- This command is a beta feature and may introduce breaking changes in future releases
- `@liam-hq/cli` is required for `export`, `serve`, and `deploy`
- `serve` is required only for `tailordb erd serve`

Install dependencies:

```bash
npm i -D @liam-hq/cli serve
# OR
yarn add -D @liam-hq/cli serve
# OR
pnpm add -D @liam-hq/cli serve
```

### tailordb erd export

Export Liam ERD dist from applied TailorDB schema.

```bash
tailor-sdk tailordb erd export [options]
```

**Options:**

- `-n, --namespace` - TailorDB namespace name (optional - exports all namespaces with erdSite if omitted)
- `-o, --output` - Output directory path for tbls-compatible ERD JSON (writes to `<outputDir>/<namespace>/schema.json`) (default: `.tailor-sdk/erd`)
- `-j, --json` - Output as JSON
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-e, --env-file` - Path to the environment file

**Usage Examples:**

```bash
# Export ERD for all namespaces with erdSite configured
tailor-sdk tailordb erd export

# Export ERD for a specific namespace
tailor-sdk tailordb erd export --namespace myNamespace

# Export ERD with custom output directory
tailor-sdk tailordb erd export --output ./my-erd

# Export ERD with JSON output
tailor-sdk tailordb erd export --json
```

### tailordb erd serve

Generate and serve ERD locally (liam build + `serve dist`).

```bash
tailor-sdk tailordb erd serve [options]
```

**Options:**

- `-n, --namespace` - TailorDB namespace name (uses first namespace with erdSite if not specified)
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-e, --env-file` - Path to the environment file

**Usage Examples:**

```bash
# Serve ERD for the first namespace with erdSite configured
tailor-sdk tailordb erd serve

# Serve ERD for a specific namespace
tailor-sdk tailordb erd serve --namespace myNamespace
```

### tailordb erd deploy

Deploy ERD static website for TailorDB namespace(s).

```bash
tailor-sdk tailordb erd deploy [options]
```

**Options:**

- `-n, --namespace` - TailorDB namespace name (optional - deploys all namespaces with erdSite if omitted)
- `-j, --json` - Output as JSON
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-e, --env-file` - Path to the environment file

**Usage Examples:**

```bash
# Deploy ERD for all namespaces with erdSite configured
tailor-sdk tailordb erd deploy

# Deploy ERD for a specific namespace
tailor-sdk tailordb erd deploy --namespace myNamespace

# Deploy ERD with JSON output
tailor-sdk tailordb erd deploy --json
```

**Notes:**

- Requires `erdSite` to be configured in `tailor.config.ts` for each namespace you want to deploy
- Example config:
  ```typescript
  export default defineConfig({
    db: {
      myNamespace: {
        // ... table definitions
        erdSite: "my-erd-site-name",
      },
    },
  });
  ```
