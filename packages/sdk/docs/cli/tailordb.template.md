---
description: "Truncate TailorDB table data and generate, test, validate, and apply TailorDB schema migrations with the tailor CLI."
politty:
  index:
    title: "TailorDB Commands"
    description: "Commands for managing TailorDB tables, data, and schema migrations."
---

# TailorDB Commands

Commands for managing TailorDB tables, data, and schema migrations.

{{politty:command:tailordb:heading}}

{{politty:command:tailordb:description}}

{{politty:command:tailordb:usage}}

{{politty:command:tailordb:global-options-link}}

{{politty:command:tailordb:subcommands}}

{{politty:command:tailordb truncate}}

**Usage Examples:**

```bash
# Truncate all tables in all namespaces (requires confirmation)
tailor tailordb truncate --all

# Truncate all tables in all namespaces (skip confirmation)
tailor tailordb truncate --all --yes

# Truncate all tables in a specific namespace
tailor tailordb truncate --namespace myNamespace

# Truncate specific tables (namespace is auto-detected)
tailor tailordb truncate User Post Comment

# Truncate specific tables with confirmation skipped
tailor tailordb truncate User Post --yes
```

**Notes:**

- Specify `--all`, `--namespace`, or table names; `--namespace` may also come with table names to look them up in that namespace only
- When truncating specific tables without `--namespace`, the namespace is found from the tables deployed in your config's namespaces; a table name that several namespaces have stops the command with `TAILORDB_TABLE_NAMESPACE_AMBIGUOUS`
- Confirmation prompts vary based on the operation:
  - `--all`: requires typing `truncate all`
  - `--namespace`: requires typing `truncate <namespace-name>`
  - Specific tables: requires typing `yes`
- Use `--yes` flag to skip confirmation prompts (useful for scripts and CI/CD)
- Namespaces declared with `{ external: true }` are skipped by `--all` and rejected with a dedicated error when targeted by `--namespace`. Run truncate from the app that owns the namespace.
- With a [workspace config](../workspace.md#commands) (Beta), `--all` truncates every TailorDB namespace of the workspace, including those no application lists.

{{politty:command:tailordb migration:heading}}

{{politty:command:tailordb migration:description}}

Note: Migration scripts are automatically executed during `tailor deploy`. See [Automatic Migration Execution](../services/tailordb/migration.md#automatic-migration-execution) for details.

{{politty:command:tailordb migration:usage}}

{{politty:command:tailordb migration:subcommands}}

{{politty:command:tailordb migration:global-options-link}}
{{politty:command:tailordb migration generate}}
{{politty:command:tailordb migration rebaseline}}
{{politty:command:tailordb migration resolve}}
{{politty:command:tailordb migration script}}
{{politty:command:tailordb migration status}}
{{politty:command:tailordb migration sync}}
{{politty:command:tailordb migration test}}
{{politty:command:tailordb migration validate}}

**See also:** For migration concepts, configuration, workflow, and troubleshooting, see the [TailorDB Migrations guide](../services/tailordb/migration.md).

{{politty:command:tailordb replication:heading}}

{{politty:command:tailordb replication:description}}

{{politty:command:tailordb replication:usage}}

{{politty:command:tailordb replication:subcommands}}

{{politty:command:tailordb replication:global-options-link}}
{{politty:command:tailordb replication list}}
{{politty:command:tailordb replication status}}
{{politty:command:tailordb replication repair}}
{{politty:command:tailordb replication destination}}

### tailordb erd (Beta)

The `tailordb erd` commands (export, diff, serve, deploy) are provided by the `@tailor-platform/sdk-plugin-tailordb-erd` CLI plugin. Install it next to the SDK and keep running `tailor tailordb erd <command>` as before:

```bash
npm install -D @tailor-platform/sdk-plugin-tailordb-erd
tailor tailordb erd export --namespace myNamespace
```

See the plugin's README for the full command reference.
