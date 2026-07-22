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
**Workspace Selection:**

After validating the configuration file, `deploy` resolves a workspace before bundling the
application. Explicit configuration takes precedence in this order: `--workspace-id`,
`TAILOR_PLATFORM_WORKSPACE_ID`, and the selected profile. Otherwise, `deploy` reuses the workspace
previously selected for that configuration from project-local state. Each config file keeps an
independent selection, including when multiple configs share a directory. An explicit workspace also
updates this selection. Saved selections are verified against the workspaces currently visible to
the authenticated user before reuse, and `deploy` warns when it uses one.

When the project has no saved selection, `deploy` discovers the account's workspaces:

- One or more workspaces open a selection prompt in an interactive terminal, with an option to
  create a new workspace. With one workspace in non-interactive or JSON mode, it is selected
  automatically. With multiple workspaces, pass `--workspace-id` instead.
- No workspaces open a guided creation flow in an interactive terminal. The flow asks for a name,
  fetches the available regions from the Platform, and confirms before creating anything. After
  creation, the output shows how to reuse the workspace with `--workspace-id` or
  `TAILOR_PLATFORM_WORKSPACE_ID` from CI or another machine.

In CI and other non-interactive environments, workspace creation must be explicit:

```bash
tailor-sdk deploy \
  --create-workspace \
  --workspace-name example-workspace \
  --workspace-region us-west
```

`--create-workspace` only creates when the account has no workspace. If the existing workspace
matches the requested name, region, organization, and folder, `deploy` reuses it so the same command
is safe to rerun. If multiple workspaces exist, the flag never creates another one or guesses which
workspace to use. `--yes` skips deployment confirmation but does not authorize workspace creation.

If a saved workspace has been deleted or is no longer accessible, interactive terminals return to
workspace selection. Non-interactive environments stop with `WORKSPACE_CONTEXT_STALE` instead of
silently switching to another workspace. Automatically selected targets are printed with their
region, organization, and workspace ID.

`--dry-run` never creates a workspace or writes project context. When an account has no workspace,
create one explicitly before requesting a deployment plan.

**Config File Modification:**

On first run, `deploy` automatically injects a stable `id: "<uuid>"` field into your `defineConfig({...})` call in `tailor.config.ts`. This UUID is used to track your application across renames so the SDK can recognize ownership across renames. Commit the generated id to version control. See [Configuration](../configuration.md#application-settings) for details.

**Multiple Config Deploys:**

To deploy interdependent applications to the same workspace in one run, pass comma-separated config paths:

```bash
tailor deploy --config apps/buyer/tailor.config.ts,apps/supplier/tailor.config.ts
```

When multiple configs are provided, `deploy` creates or updates all configured services first, then updates the applications. This lets one application reference resources owned by another config with `external: true` during the same deploy.

Each config's `files` and `ignores` patterns (see [Service Configuration](../configuration.md#service-configuration)) resolve relative to that config's own directory, not the directory you ran `deploy` from. For example, `apps/buyer/tailor.config.ts` declaring `files: ["db/**/*.ts"]` loads files from `apps/buyer/db/`, independent of where `apps/supplier/tailor.config.ts`'s patterns resolve. If a config's relative patterns match nothing under its own directory, the SDK falls back to the invocation directory and logs a warning (see [Service Configuration](../configuration.md#service-configuration) for details).

**Migration Handling:**

When migrations are configured (`db.tailordb.migration` in config), the `deploy` command automatically:

1. Detects pending migration scripts that haven't been executed
2. Applies schema changes in a safe order (pre-migration → script execution → post-migration)
3. Runs the pending migration scripts
4. Updates the migration checkpoint so the same migrations are not re-run

See [Automatic Migration Execution](../services/tailordb-migration.md#automatic-migration-execution) for details on automatic migration execution.

**Concurrent Deploys:**

Deploys that target the same workspace and application from the same project directory are serialized while secrets and auth connections are updated: one deploy proceeds and the other waits for it to finish. A deploy that cannot proceed within 5 minutes fails with an error, which normally means another deploy is still running. If a previous deploy was interrupted, the next deploy recovers automatically within about a minute. Deploys to different workspaces or applications are not affected.

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
