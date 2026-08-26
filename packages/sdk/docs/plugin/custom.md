# Custom Plugins (Beta)

> **Beta Feature**: The custom plugin API is in beta and may change in future releases.

Create your own plugins by implementing the `Plugin` interface.

## Requirements

**Plugins must use default export**:

```typescript
// plugin.ts
const myPlugin: Plugin = {
  id: "@my-company/my-plugin",
  // ...
};

export default myPlugin; // Required: must be default export
```

This is required so that other plugins and generation-time hooks can use plugin-generated TailorDB tables via `getGeneratedTable()`.

## Plugin Interface

```typescript
interface Plugin<TableConfig = unknown, PluginConfig = unknown> {
  readonly id: string;
  readonly description: string;
  readonly importPath?: string;
  readonly tableConfigRequired?: boolean | ((pluginConfig?: PluginConfig) => boolean);
  readonly pluginConfig?: PluginConfig;

  // Definition-time hooks
  onTableLoaded?(
    context: PluginTableProcessContext<TableConfig, PluginConfig>,
  ): TablePluginOutput | Promise<TablePluginOutput>;
  onNamespaceLoaded?(
    context: PluginNamespaceProcessContext<PluginConfig>,
  ): PluginOutput | Promise<PluginOutput>;

  // Generation-time hooks
  onTailorDBReady?(
    context: TailorDBReadyContext<PluginConfig>,
  ): GeneratorResult | Promise<GeneratorResult>;
  onResolverReady?(
    context: ResolverReadyContext<PluginConfig>,
  ): GeneratorResult | Promise<GeneratorResult>;
  onExecutorReady?(
    context: ExecutorReadyContext<PluginConfig>,
  ): GeneratorResult | Promise<GeneratorResult>;
}
```

| Property              | Required                         | Description                                                                                      |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `id`                  | Yes                              | Unique plugin identifier (e.g., `"@my-company/soft-delete"`)                                     |
| `description`         | Yes                              | Human-readable description                                                                       |
| `importPath`          | When using definition-time hooks | Path resolvable from `tailor.config.ts` directory. Used for import statements in generated code. |
| `tableConfigRequired` | No                               | Whether per-table config is required when attaching via `.plugin()`. Default: optional.          |
| `pluginConfig`        | No                               | Plugin-level config passed via `definePlugins()`. Set via factory function.                      |

## Hook Reference

### onTableLoaded

**Trigger**: Called once for each TailorDB table that has `.plugin({ pluginId: config })` attached.

**Context** (`PluginTableProcessContext`):

| Field          | Type              | Description                                |
| -------------- | ----------------- | ------------------------------------------ |
| `table`        | `TailorAnyDBType` | The TailorDB table being processed         |
| `tableConfig`  | `TableConfig`     | Per-table config from `.plugin()`          |
| `pluginConfig` | `PluginConfig`    | Plugin-level config from `definePlugins()` |
| `namespace`    | `string`          | Namespace of the TailorDB table            |

**Returns** (`TablePluginOutput`):

| Field       | Type                                            | Description                                            |
| ----------- | ----------------------------------------------- | ------------------------------------------------------ |
| `tables`    | `Record<string, TailorAnyDBType>`               | Additional TailorDB tables to generate (keyed by kind) |
| `resolvers` | `PluginGeneratedResolver[]`                     | Additional resolvers to generate                       |
| `executors` | `PluginGeneratedExecutor[]`                     | Additional executors to generate                       |
| `extends`   | `{ fields?: Record<string, TailorAnyDBField> }` | Fields to add to the source table                      |

**Use cases**:

- Generate derived tables (e.g., archive tables, history tables) from user-defined tables
- Add fields to existing tables (e.g., `deletedAt` for soft delete)
- Generate executors triggered by record events on the source table

```typescript
onTableLoaded(context) {
  const { table, tableConfig, namespace } = context;
  return {
    tables: { archive: db.table(`Deleted_${table.name}`, { ... }) },
    extends: { fields: { deletedAt: db.datetime({ optional: true }) } },
    executors: [{ name: `${table.name}-on-delete`, resolve: async () => await import("./on-delete"), context: { sourceTable: table, namespace } }],
  };
},
```

### onNamespaceLoaded

**Trigger**: Called once per namespace for plugins that do not require a source table.

**Context** (`PluginNamespaceProcessContext`):

| Field          | Type           | Description                                |
| -------------- | -------------- | ------------------------------------------ |
| `pluginConfig` | `PluginConfig` | Plugin-level config from `definePlugins()` |
| `namespace`    | `string`       | Target namespace                           |

**Returns** (`PluginOutput`):

Same as `TablePluginOutput` but without `extends` (namespace plugins cannot extend a source table).

**Use cases**:

- Generate tables that don't derive from a specific user table (e.g., audit log, settings table)

```typescript
onNamespaceLoaded(context) {
  return {
    tables: { auditLog: db.table("AuditLog", { action: db.string(), ... }) },
  };
},
```

### onTailorDBReady

**Trigger**: Called once after all TailorDB tables are loaded and auth is resolved.

**Context** (`TailorDBReadyContext`):

| Field          | Type                      | Description                                                     |
| -------------- | ------------------------- | --------------------------------------------------------------- |
| `tailordb`     | `TailorDBNamespaceData[]` | All namespaces with tables, source info, and plugin attachments |
| `auth`         | `GeneratorAuthInput?`     | Auth configuration (machine users, OAuth2 clients, etc.)        |
| `baseDir`      | `string`                  | Output directory for generated files                            |
| `configPath`   | `string`                  | Path to `tailor.config.ts`                                      |
| `pluginConfig` | `PluginConfig`            | Plugin-level config from `definePlugins()`                      |

`TailorDBNamespaceData` contains:

| Field               | Type                                       | Description                           |
| ------------------- | ------------------------------------------ | ------------------------------------- |
| `namespace`         | `string`                                   | Namespace name                        |
| `tables`            | `Record<string, TailorDBType>`             | All finalized tables in the namespace |
| `sourceInfo`        | `ReadonlyMap<string, TypeSourceInfoEntry>` | Source file info for each table       |
| `pluginAttachments` | `ReadonlyMap<string, PluginAttachment[]>`  | Plugin configs attached to each table |

**Returns** (`GeneratorResult`):

| Field    | Type                                                   | Description              |
| -------- | ------------------------------------------------------ | ------------------------ |
| `files`  | `Array<{ path, content, skipIfExists?, executable? }>` | Files to write to disk   |
| `errors` | `string[]?`                                            | Error messages to report |

**Use cases**:

- Generate table definitions (e.g., Kysely types, enum constants)
- Generate seed data scaffolding from table schemas
- Generate table lists or metadata files

```typescript
onTailorDBReady(ctx) {
  const allTables = ctx.tailordb.flatMap((ns) =>
    Object.values(ns.tables).map((table) => table.name),
  );
  return {
    files: [{ path: `${ctx.baseDir}/tables.ts`, content: `export const tables = ${JSON.stringify(allTables)};\n` }],
  };
},
```

### onResolverReady

**Trigger**: Called once after all resolvers are loaded, for plugins that do not implement `onExecutorReady`.

**Context** (`ResolverReadyContext`):

All fields from `TailorDBReadyContext`, plus:

| Field       | Type                      | Description                         |
| ----------- | ------------------------- | ----------------------------------- |
| `resolvers` | `ResolverNamespaceData[]` | All namespaces with their resolvers |

`ResolverNamespaceData` contains:

| Field       | Type                       | Description                    |
| ----------- | -------------------------- | ------------------------------ |
| `namespace` | `string`                   | Namespace name                 |
| `resolvers` | `Record<string, Resolver>` | All resolvers in the namespace |

**Returns**: `GeneratorResult` (same as `onTailorDBReady`)

**Use cases**:

- Generate API client code from resolver definitions
- Generate documentation that includes resolver endpoints

```typescript
onResolverReady(ctx) {
  const resolverNames = ctx.resolvers.flatMap((ns) =>
    Object.values(ns.resolvers).map((r) => r.name),
  );
  return {
    files: [{ path: `${ctx.baseDir}/api.ts`, content: generateApiClient(resolverNames) }],
  };
},
```

### onExecutorReady

**Trigger**: Called once after all executors are loaded.

**Context** (`ExecutorReadyContext`):

All fields from `ResolverReadyContext`, plus:

| Field       | Type                       | Description                            |
| ----------- | -------------------------- | -------------------------------------- |
| `executors` | `Record<string, Executor>` | All executors (keyed by executor name) |

**Returns**: `GeneratorResult` (same as `onTailorDBReady`)

**Use cases**:

- Generate dashboards or reports that need the full application topology
- Generate configuration files that reference all services

```typescript
onExecutorReady(ctx) {
  const summary = {
    tables: ctx.tailordb.flatMap((ns) => Object.keys(ns.tables)),
    resolvers: ctx.resolvers.flatMap((ns) => Object.keys(ns.resolvers)),
    executors: Object.keys(ctx.executors),
  };
  return {
    files: [{ path: `${ctx.baseDir}/app-summary.json`, content: JSON.stringify(summary, null, 2) }],
  };
},
```

## Hook Scheduling Rules

Each generation-time hook runs at its own pipeline phase, regardless of what other hooks the same plugin implements:

| Hook              | Runs after       | Data provided                                   |
| ----------------- | ---------------- | ----------------------------------------------- |
| `onTailorDBReady` | TailorDB loaded  | `tailordb` + `auth`                             |
| `onResolverReady` | Resolvers loaded | `tailordb` + `resolvers` + `auth`               |
| `onExecutorReady` | Executors loaded | `tailordb` + `resolvers` + `executors` + `auth` |

A plugin implementing multiple hooks (e.g., both `onTailorDBReady` and `onResolverReady`) will have each hook called at its natural phase. This ensures that files generated by `onTailorDBReady` are available when resolvers are loaded, before `onResolverReady` runs.

## Import Types

All context and result types are exported from `@tailor-platform/sdk`:

```typescript
import type {
  Plugin,
  PluginTableProcessContext,
  TablePluginOutput,
  PluginOutput,
  TailorDBReadyContext,
  ResolverReadyContext,
  ExecutorReadyContext,
  TailorDBNamespaceData,
  ResolverNamespaceData,
  GeneratorResult,
} from "@tailor-platform/sdk";
```

## getGeneratedTable Helper

The SDK provides an async `getGeneratedTable()` helper function to retrieve plugin-generated TailorDB tables. This enables plugins and other tools to work with tables generated by plugins.

```typescript
import { join } from "node:path";
import { getGeneratedTable } from "@tailor-platform/sdk/plugin";
import { customer } from "./tailordb/customer";

const configPath = join(import.meta.dirname, "./tailor.config.ts");

// Table-attached plugin
const DeletedCustomer = await getGeneratedTable(
  configPath,
  "@example/soft-delete",
  customer,
  "archive",
);

// Namespace plugin (pass null as sourceTable)
const AuditLog = await getGeneratedTable(configPath, "@example/audit-log", null, "auditLog");
```

**Parameters:**

- `configPath`: Path to `tailor.config.ts` (absolute or relative to cwd)
- `pluginId`: The plugin's unique identifier (e.g., `"@example/soft-delete"`)
- `sourceTable`: The TailorDB table that the plugin is attached to (`null` for namespace plugins)
- `kind`: The generated table kind (e.g., `"archive"`, `"auditLog"`)

**How it works:**

1. Loads and caches the config from the given path
2. Finds the plugin by ID from `definePlugins()` exports
3. Auto-resolves the namespace from config
4. Calls the plugin's `onTableLoaded()` or `onNamespaceLoaded()` method
5. Caches the result to avoid redundant processing
6. Returns the generated table matching the specified kind

## Examples

### Definition-time Plugin (Soft Delete)

A plugin that adds soft delete functionality via `onTableLoaded`:

```typescript
// plugins/soft-delete/plugin.ts
import { db } from "@tailor-platform/sdk";
import type { Plugin, PluginTableProcessContext, TablePluginOutput } from "@tailor-platform/sdk";

interface SoftDeleteTableConfig {
  archiveReason?: boolean;
  retentionDays?: number;
}

interface SoftDeletePluginConfig {
  archiveTablePrefix?: string;
  defaultRetentionDays?: number;
  requireTableConfig?: boolean;
}

function processSoftDelete(
  context: PluginTableProcessContext<SoftDeleteTableConfig, SoftDeletePluginConfig>,
): TablePluginOutput {
  const { table, tableConfig, pluginConfig, namespace } = context;
  const prefix = pluginConfig?.archiveTablePrefix ?? "Deleted_";

  // Generate archive table
  const archiveTable = db
    .table(`${prefix}${table.name}`, {
      originalId: db.uuid().description("ID of the deleted record"),
      originalData: db.string().description("JSON snapshot of deleted record"),
      deletedAt: db.datetime().description("When the record was deleted"),
      deletedBy: db.uuid().description("User who deleted the record"),
      ...(tableConfig.archiveReason && {
        reason: db.string({ optional: true }).description("Reason for deletion"),
      }),
      ...db.fields.timestamps(),
    })
    .description(`Archive for deleted ${table.name} records`);

  // Extend source table with deletedAt field
  const extendFields = {
    deletedAt: db.datetime({ optional: true }).description("Soft delete timestamp"),
  };

  return {
    tables: { archive: archiveTable },
    extends: { fields: extendFields },
    executors: [
      {
        name: `${table.name.toLowerCase()}-on-delete`,
        resolve: async () => await import("./executors/on-delete"),
        context: {
          sourceTable: table,
          archiveTable,
          namespace,
        },
      },
    ],
  };
}

function createSoftDeletePlugin(
  pluginConfig?: SoftDeletePluginConfig,
): Plugin<SoftDeleteTableConfig, SoftDeletePluginConfig> {
  return {
    id: "@example/soft-delete",
    description: "Adds soft delete with archive functionality",
    importPath: "./plugins/soft-delete",
    pluginConfig,
    tableConfigRequired: (config) => config?.requireTableConfig === true,
    onTableLoaded: processSoftDelete,
  };
}

export default createSoftDeletePlugin();
```

#### Executor with Context

```typescript
// plugins/soft-delete/executors/on-delete.ts
import { createExecutor, recordDeletedTrigger } from "@tailor-platform/sdk";
import type { TailorAnyDBType } from "@tailor-platform/sdk";
import { withPluginContext } from "@tailor-platform/sdk/plugin";
import { getDB } from "generated/tailordb";

interface SoftDeleteContext {
  sourceTable: TailorAnyDBType;
  archiveTable: TailorAnyDBType;
  namespace: string;
}

export default withPluginContext((ctx: SoftDeleteContext) => {
  const { sourceTable, archiveTable, namespace } = ctx;

  return createExecutor({
    name: `${sourceTable.name.toLowerCase()}-on-delete`,
    description: `Archives deleted ${sourceTable.name} records`,
    trigger: recordDeletedTrigger({ type: sourceTable }),
    operation: {
      kind: "function",
      body: async ({ oldRecord, user }) => {
        const db = getDB(namespace as "tailordb");
        await db
          .insertInto(archiveTable.name)
          .values({
            originalId: oldRecord.id,
            originalData: JSON.stringify(oldRecord),
            deletedAt: new Date(),
            deletedBy: user?.id ?? "system",
          })
          .execute();
      },
    },
  });
});
```

#### Usage

```typescript
// tailor.config.ts
import { definePlugins } from "@tailor-platform/sdk";
import softDeletePlugin from "./plugins/soft-delete";

export const plugins = definePlugins(
  softDeletePlugin({
    archiveTablePrefix: "Deleted_",
    defaultRetentionDays: 90,
  }),
);

// tailordb/customer.ts
export const customer = db
  .table("Customer", {
    name: db.string(),
    email: db.string(),
  })
  .plugin({
    "@example/soft-delete": {
      archiveReason: true,
    },
  });
```

### Generation-only Plugin (Table List)

A plugin that only uses `onTailorDBReady` to generate output files:

```typescript
import type { Plugin, GeneratorResult } from "@tailor-platform/sdk";

const tableListPlugin: Plugin = {
  id: "@example/table-list",
  description: "Generates a list of all TailorDB table names",

  onTailorDBReady(ctx): GeneratorResult {
    const allTables = ctx.tailordb.flatMap((ns) =>
      Object.values(ns.tables).map((table) => ({
        name: table.name,
        fieldCount: Object.keys(table.fields).length,
        namespace: ns.namespace,
      })),
    );
    const content = `// Generated table list\nexport const tables = ${JSON.stringify(allTables, null, 2)} as const;\n`;
    return {
      files: [{ path: `${ctx.baseDir}/tables.ts`, content }],
    };
  },
};
```

### Hybrid Plugin (Definition + Generation)

A plugin that uses both definition-time and generation-time hooks:

```typescript
const plugin: Plugin = {
  id: "@example/hybrid",
  description: "Generates derived tables and produces output files",
  importPath: "./plugins/hybrid",

  // Definition-time: Generate additional tables from attached source tables
  onTableLoaded(context) {
    return { tables: { derived: createDerivedTable(context.table) } };
  },

  // Generation-time: Generate output files from all finalized tables
  onTailorDBReady(ctx) {
    const allTables = ctx.tailordb.flatMap((ns) =>
      Object.values(ns.tables).map((table) => table.name),
    );
    return {
      files: [{ path: `${ctx.baseDir}/output.ts`, content: generateCode(allTables) }],
    };
  },
};
```

## Adding Type Safety

### Plugin-level type safety (TableConfig / PluginConfig)

Use TypeScript type parameters on `Plugin<TableConfig, PluginConfig>` to get type-safe config
in `onTableLoaded` and `onNamespaceLoaded` methods:

```typescript
interface MyTableConfig {
  archiveReason?: boolean;
}

interface MyPluginConfig {
  prefix?: string;
}

const plugin: Plugin<MyTableConfig, MyPluginConfig> = {
  id: "@example/my-plugin",
  // ...
  onTableLoaded(context) {
    // context.tableConfig is MyTableConfig
    // context.pluginConfig is MyPluginConfig
  },
};
```

### Per-table `.plugin()` type safety (declaration merging)

To enable type checking when users attach plugins via `.plugin()`, provide a declaration merge
for the `PluginConfigs` interface. Plugin authors should ship this in their package's type definitions:

```typescript
// your-plugin/types.d.ts (shipped with your plugin package)
export {}; // required: a top-level import/export makes this file augment
// the module below instead of replacing its other exports

declare module "@tailor-platform/sdk" {
  interface PluginConfigs<Fields extends string> {
    "@example/soft-delete": {
      archiveReason?: boolean;
      retentionDays?: number;
    };
  }
}
```

The `Fields` type parameter provides field names from the table being configured, enabling field-aware configurations:

```typescript
export {};

declare module "@tailor-platform/sdk" {
  interface PluginConfigs<Fields extends string> {
    "@example/i18n": {
      labels: Partial<Record<Fields, { ja: string; en: string }>>;
    };
  }
}
```

### Resolving plugin-level config from a `Plugin[]` array (declaration merging)

`PluginConfig` is already available inside your own plugin's hooks via `context.pluginConfig`.
If other code instead needs to look up your plugin's config from a `Plugin[]` array by `id` —
without importing your plugin's config type — register it on the `PluginConfigRegistry`
interface. Plugin authors should ship this in their package's type definitions:

```typescript
// your-plugin/types.d.ts (shipped with your plugin package)
export {}; // required: a top-level import/export makes this file augment
// the module below instead of replacing its other exports

declare module "@tailor-platform/sdk/plugin" {
  interface PluginConfigRegistry {
    "@example/soft-delete": {
      archiveTablePrefix?: string;
    };
  }
}
```

This only registers the type; it does not provide a function to read it. Callers resolve a
registered config from `Plugin[]` using the public `Plugin` and `PluginConfigRegistry` types:

```typescript
import type { Plugin } from "@tailor-platform/sdk";
import type { PluginConfigRegistry } from "@tailor-platform/sdk/plugin";

function resolvePluginConfig<Id extends keyof PluginConfigRegistry>(
  plugins: readonly Plugin[],
  id: Id,
): PluginConfigRegistry[Id] | undefined {
  return plugins.find((p) => p.id === id)?.pluginConfig as PluginConfigRegistry[Id] | undefined;
}
```

An `id` that isn't registered fails to compile, instead of silently resolving to `unknown`.
