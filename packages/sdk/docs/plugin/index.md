# Plugins (Beta)

> **Beta Feature**: The plugin system is currently in beta. APIs may change in future releases.

Plugins extend TailorDB tables by automatically generating additional tables, executors, and output files based on your table definitions.

## Overview

When you run `tailor generate`, the SDK:

1. Loads all TailorDB tables with plugin attachments
2. Passes each table to the attached plugins
3. Generates additional tables and executors based on plugin output
4. Writes all generated files to the appropriate locations

This enables plugins to create derived functionality based on your application's schema.

## Configuration

### Registering Plugins

Define plugins in `tailor.config.ts` using `definePlugins()`:

```typescript
import { defineConfig, definePlugins } from "@tailor-platform/sdk";
import myPlugin from "./plugins/my-plugin";

export const plugins = definePlugins(myPlugin);

export default defineConfig({
  name: "my-app",
  // ...
});
```

**Important**: The `plugins` export must be a named export (not default).

### Attaching Plugins to Tables

Use the `.plugin()` method to attach plugins to specific tables:

```typescript
import { db } from "@tailor-platform/sdk";

export const user = db
  .table("User", {
    name: db.string(),
    email: db.string(),
  })
  .plugin({
    "@example/my-plugin": {},
  });
```

### Plugin Configuration

Some plugins accept per-table configuration:

```typescript
export const customer = db
  .table("Customer", {
    name: db.string(),
    // ...
  })
  .plugin({
    "@example/soft-delete": {
      archiveReason: true,
      retentionDays: 90,
    },
  });
```

### Per-table Config Requirement

Per-table config is optional by default. Plugin authors can change this with
`tableConfigRequired` (boolean or function). When a function is used, it receives
the plugin-level config from `definePlugins()`.

### Global Plugin Configuration

Plugins can also accept global configuration via `definePlugins()`:

```typescript
import { definePlugins } from "@tailor-platform/sdk";
import { softDeletePlugin } from "./plugins/soft-delete";

export const plugins = definePlugins(
  // Custom plugin with global config (factory function)
  softDeletePlugin({
    archiveTablePrefix: "Deleted_",
    defaultRetentionDays: 90,
  }),
);
```

## Generated Output

Plugins can generate:

- **Tables**: Additional TailorDB tables (e.g., `CustomerHistory`, `Deleted_Customer`)
- **Executors**: Event handlers triggered by record changes
- **Field Extensions**: Additional fields added to the source table
- **Output Files**: TypeScript code and other files via generation-time hooks

Tables produced by definition-time hooks are validated before registration. This includes
generated tables and source tables after field extensions are applied. Malformed output stops
the build with an error that identifies the plugin and relevant table output, without partially
registering tables from that processing step.

Generated files are placed under `.tailor/<plugin-id>/` (the plugin ID is sanitized,
e.g. `@example/soft-delete` → `example-soft-delete`), such as:

- `.tailor/example-soft-delete/types`
- `.tailor/example-soft-delete/executors`

## Plugin Lifecycle

Plugins have 5 hooks across two lifecycle phases. Each hook fires at a specific point in the `tailor generate` pipeline:

```
tailor generate
│
├─ Load TailorDB tables
│   ├─ onTableLoaded       ← per table with .plugin() attached
│   └─ onNamespaceLoaded   ← once per namespace (namespace plugins)
│
├─ Resolve Auth
│
├─ onTailorDBReady           ← all tables finalized
│
├─ Load Resolvers
│
├─ onResolverReady           ← all resolvers finalized
│
├─ Load Executors
│
└─ onExecutorReady           ← all executors finalized
```

### Definition-time hooks

| Hook                | Trigger                              | Can do                                                            |
| ------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| `onTableLoaded`     | Each table with `.plugin()` attached | Generate tables, resolvers, executors; extend source table fields |
| `onNamespaceLoaded` | Once per namespace                   | Generate tables, resolvers, executors                             |

These hooks produce TailorDB tables, resolvers, and executors that become part of the application. Requires `importPath` on the plugin.

### Generation-time hooks

| Hook              | Available data                              | Can do             |
| ----------------- | ------------------------------------------- | ------------------ |
| `onTailorDBReady` | TailorDB tables, Auth                       | Write output files |
| `onResolverReady` | TailorDB tables, Resolvers, Auth            | Write output files |
| `onExecutorReady` | TailorDB tables, Resolvers, Executors, Auth | Write output files |

These hooks receive all finalized data and produce output files (TypeScript code, etc.). No `importPath` required.

A plugin can implement hooks from either or both phases.

## Creating Custom Plugins

See [Custom Plugins](./custom.md) for the full hook reference and examples.
