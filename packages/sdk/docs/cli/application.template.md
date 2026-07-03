---
politty:
  index:
    title: "Application Commands"
    description: "Commands for managing Tailor Platform applications (work with `tailor.config.ts`)."
---

# Application Commands

Commands for managing Tailor Platform applications. These commands work with `tailor.config.ts`.

{{politty:command:init}}
{{politty:command:generate}}
{{politty:command:deploy}}
**Config File Modification:**

On first run, `deploy` automatically injects a stable `id: "<uuid>"` field into your `defineConfig({...})` call in `tailor.config.ts`. This UUID is used to track your application across renames so the SDK can recognize ownership across renames. Commit the generated id to version control. See [Configuration](../configuration.md#application-settings) for details.

**Multiple Config Deploys:**

To deploy interdependent applications to the same workspace in one run, pass comma-separated config paths:

```bash
tailor deploy --config apps/buyer/tailor.config.ts,apps/supplier/tailor.config.ts
```

When multiple configs are provided, `deploy` creates or updates all configured services first, then updates the applications. This lets one application reference resources owned by another config with `external: true` during the same deploy.

**Migration Handling:**

When migrations are configured (`db.tailordb.migration` in config), the `deploy` command automatically:

1. Detects pending migration scripts that haven't been executed
2. Applies schema changes in a safe order (pre-migration → script execution → post-migration)
3. Runs the pending migration scripts
4. Updates the migration checkpoint so the same migrations are not re-run

See [Automatic Migration Execution](../services/tailordb-migration.md#automatic-migration-execution) for details on automatic migration execution.

**Schema Check:**

By default, `deploy` performs two verification steps:

1. **Local schema check**: Verifies that local schema changes match the migration files. This ensures migrations are properly generated before deployment.
2. **Remote schema check**: Verifies that the remote schema matches the expected state based on migration history. This detects schema drift caused by manual changes or other developers.

If remote schema drift is detected, the deploy will fail with an error showing the differences. This helps prevent applying migrations to an inconsistent state.

Use `--no-schema-check` to skip both verifications (not recommended for production).

**Plan Output:**

Before applying changes, `deploy` shows a preview of the planned resource changes.

- `+` means the resource will be created
- `~` means the resource will be updated
- `-` means the resource will be deleted
- `±` means the resource will be replaced

After the detailed list, a summary line is printed:

```text
Plan: 5 to create, 3 to update, 1 to delete
```

Use `--dry-run` to preview the plan without applying anything. In dry-run mode the plan is written to **stdout**, so it can be captured in CI without `2>&1`:

```bash
tailor deploy --dry-run > plan.txt
```

In apply mode, the plan is printed to stderr so it does not interfere with piped output.

**JSON Output:**

Pass the global `--json` / `-j` flag to get machine-readable output.

**Dry-run** (`--dry-run --json`): writes a JSON object to stdout:

```json
{
  "summary": { "create": 2, "update": 1, "delete": 0, "replace": 0 },
  "changes": [{ "action": "create", "name": "Order", "labels": ["type"], "namespace": "tailordb" }],
  "warnings": [
    { "type": "unmanaged", "resourceType": "tailorDB", "name": "LegacyType" },
    { "type": "skippedSecret", "resourceType": "secret", "name": "DB_PASSWORD" }
  ],
  "conflicts": [{ "resourceType": "tailorDB", "name": "User", "currentOwner": "other-app" }]
}
```

- `summary` — counts of each change type.
- `changes` — planned resource changes, each with `action`, `name`, and optional `labels` / `namespace`.
- `warnings` — resources not in config (`type: "unmanaged"`) or secrets with missing values (`type: "skippedSecret"`). Unmanaged resources require confirmation in apply mode (apply is cancelled if declined); skipped secrets are non-blocking.
- `conflicts` — resources owned by another application that conflict with the current config. Require confirmation in apply mode; apply is cancelled if declined.

**Apply** (`--json`): writes a JSON object to stdout:

```json
{ "summary": { "create": 1, "update": 2, "delete": 0, "replace": 0 }, "status": "applied" }
```

{{politty:command:remove}}
{{politty:command:show}}
{{politty:command:open}}
{{politty:command:api}}
