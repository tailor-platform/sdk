---
politty:
  index:
    title: "TailorDB Commands"
    description: "Commands for managing TailorDB tables, data, and schema migrations."
---

# TailorDB Commands

Commands for managing TailorDB tables, data, and schema migrations.

{{politty:command:tailordb}}
{{politty:command:tailordb truncate}}
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
- Namespaces declared with `{ external: true }` are skipped by `--all` and rejected with a dedicated error when targeted by `--namespace`. Run truncate from the app that owns the namespace.

{{politty:command:tailordb migration:heading}}

{{politty:command:tailordb migration:description}}

Note: Migration scripts are automatically executed during `tailor-sdk deploy`. See [Automatic Migration Execution](../services/tailordb-migration.md#automatic-migration-execution) for details.

{{politty:command:tailordb migration:usage}}

{{politty:command:tailordb migration:subcommands}}

{{politty:command:tailordb migration:global-options-link}}
{{politty:command:tailordb migration generate}}
{{politty:command:tailordb migration script}}
{{politty:command:tailordb migration set}}
{{politty:command:tailordb migration status}}
{{politty:command:tailordb migration sync}}
**See also:** For migration concepts, configuration, workflow, and troubleshooting, see the [TailorDB Migrations guide](../services/tailordb-migration.md).

{{politty:command:tailordb erd}}
{{politty:command:tailordb erd export}}
{{politty:command:tailordb erd serve}}
{{politty:command:tailordb erd deploy}}
**Notes:**

- ERD commands build from the local TailorDB schema, including plugin-generated TailorDB types.
- `tailordb erd export` writes a self-contained `index.html` viewer to `<output>/<namespace>/dist`.
- `tailordb erd serve` watches the config file and TailorDB type files, then reloads the browser viewer when the rebuilt `index.html` reports a new embedded schema revision.
- `tailordb erd deploy` still requires `erdSite` in `tailor.config.ts` because it uploads the generated viewer to a configured Static Website.

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

- This command is a beta feature and may introduce breaking changes in future releases
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
