---
politty:
  index:
    title: "Application Commands"
    description: "Commands for managing Tailor Platform applications (work with `tailor.config.ts`)."
---

# Application Commands

Commands for managing Tailor Platform applications. These commands work with `tailor.config.ts`.

{{politty:command:init:heading}}

{{politty:command:init:description}}

{{politty:command:init:usage}}

{{politty:command:init:arguments}}

{{politty:command:init:options}}

{{politty:command:init:global-options-link}}

{{politty:command:generate:heading}}

{{politty:command:generate:description}}

{{politty:command:generate:usage}}

{{politty:command:generate:options}}

{{politty:command:generate:global-options-link}}

{{politty:command:deploy:heading}}

{{politty:command:deploy:description}}

{{politty:command:deploy:usage}}

{{politty:command:deploy:options}}

{{politty:command:deploy:global-options-link}}

**Config File Modification:**

On first run, `deploy` automatically injects a stable `id: "<uuid>"` field into your `defineConfig({...})` call in `tailor.config.ts`. This UUID is used to track your application across renames so the SDK can recognize ownership across renames. Commit the generated id to version control. See [Configuration](../configuration.md#application-settings) for details.

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
Plan: 5 to create, 3 to update, 1 to delete, 25 unchanged
```

Use `--dry-run` to preview the plan without applying anything.

{{politty:command:remove:heading}}

{{politty:command:remove:description}}

{{politty:command:remove:usage}}

{{politty:command:remove:options}}

{{politty:command:remove:global-options-link}}

{{politty:command:show:heading}}

{{politty:command:show:description}}

{{politty:command:show:usage}}

{{politty:command:show:options}}

{{politty:command:show:global-options-link}}

{{politty:command:open:heading}}

{{politty:command:open:description}}

{{politty:command:open:usage}}

{{politty:command:open:options}}

{{politty:command:open:global-options-link}}

{{politty:command:api:heading}}

{{politty:command:api:description}}

{{politty:command:api:usage}}

{{politty:command:api:arguments}}

{{politty:command:api:options}}

{{politty:command:api:global-options-link}}

{{politty:command:api:examples}}

{{politty:command:api:notes}}
{{politty:command:api inspect:heading}}

{{politty:command:api inspect:description}}

{{politty:command:api inspect:usage}}

{{politty:command:api inspect:arguments}}

{{politty:command:api inspect:global-options-link}}

{{politty:command:api inspect:examples}}

{{politty:command:api inspect:notes}}

{{politty:command:api list:heading}}

{{politty:command:api list:description}}

{{politty:command:api list:usage}}

{{politty:command:api list:global-options-link}}

{{politty:command:api list:notes}}
