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

This is required so that generators can use plugin-generated TailorDB types via `getGeneratedType()`.

## Plugin Interface

```typescript
interface Plugin<TypeConfig = unknown, PluginConfig = unknown> {
  readonly id: string;
  readonly description: string;
  readonly importPath?: string;
  readonly typeConfigRequired?: boolean | ((pluginConfig?: PluginConfig) => boolean);
  readonly pluginConfig?: PluginConfig;

  // Definition-time hooks
  onTypeLoaded?(
    context: PluginProcessContext<TypeConfig, PluginConfig>,
  ): TypePluginOutput | Promise<TypePluginOutput>;
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

| Property             | Required                         | Description                                                                                      |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `id`                 | Yes                              | Unique plugin identifier (e.g., `"@my-company/soft-delete"`)                                     |
| `description`        | Yes                              | Human-readable description                                                                       |
| `importPath`         | When using definition-time hooks | Path resolvable from `tailor.config.ts` directory. Used for import statements in generated code. |
| `typeConfigRequired` | No                               | Whether per-type config is required when attaching via `.plugin()`. Default: optional.           |
| `pluginConfig`       | No                               | Plugin-level config passed via `definePlugins()`. Set via factory function.                      |

## Hook Reference

### onTypeLoaded

**Trigger**: Called once for each TailorDB type that has `.plugin({ pluginId: config })` attached.

**Context** (`PluginProcessContext`):

| Field          | Type              | Description                                |
| -------------- | ----------------- | ------------------------------------------ |
| `type`         | `TailorAnyDBType` | The TailorDB type being processed          |
| `typeConfig`   | `TypeConfig`      | Per-type config from `.plugin()`           |
| `pluginConfig` | `PluginConfig`    | Plugin-level config from `definePlugins()` |
| `namespace`    | `string`          | Namespace of the TailorDB type             |

**Returns** (`TypePluginOutput`):

| Field       | Type                                            | Description                                           |
| ----------- | ----------------------------------------------- | ----------------------------------------------------- |
| `types`     | `Record<string, TailorAnyDBType>`               | Additional TailorDB types to generate (keyed by kind) |
| `resolvers` | `PluginGeneratedResolver[]`                     | Additional resolvers to generate                      |
| `executors` | `PluginGeneratedExecutor[]`                     | Additional executors to generate                      |
| `extends`   | `{ fields?: Record<string, TailorAnyDBField> }` | Fields to add to the source type                      |

**Use cases**:

- Generate derived types (e.g., archive tables, history tables) from user-defined types
- Add fields to existing types (e.g., `deletedAt` for soft delete)
- Generate executors triggered by record events on the source type

```typescript
onTypeLoaded(context) {
  const { type, typeConfig, namespace } = context;
  return {
    types: { archive: db.type(`Deleted_${type.name}`, { ... }) },
    extends: { fields: { deletedAt: db.datetime({ optional: true }) } },
    executors: [{ name: `${type.name}-on-delete`, resolve: async () => await import("./on-delete"), context: { sourceType: type, namespace } }],
  };
},
```

### onNamespaceLoaded

**Trigger**: Called once per namespace for plugins that do not require a source type.

**Context** (`PluginNamespaceProcessContext`):

| Field          | Type           | Description                                |
| -------------- | -------------- | ------------------------------------------ |
| `pluginConfig` | `PluginConfig` | Plugin-level config from `definePlugins()` |
| `namespace`    | `string`       | Target namespace                           |

**Returns** (`PluginOutput`):

Same as `TypePluginOutput` but without `extends` (namespace plugins cannot extend a source type).

**Use cases**:

- Generate types that don't derive from a specific user type (e.g., audit log, settings table)

```typescript
onNamespaceLoaded(context) {
  return {
    types: { auditLog: db.type("AuditLog", { action: db.string(), ... }) },
  };
},
```

### onTailorDBReady

**Trigger**: Called once after all TailorDB types are loaded and auth is resolved.

**Context** (`TailorDBReadyContext`):

| Field          | Type                      | Description                                                    |
| -------------- | ------------------------- | -------------------------------------------------------------- |
| `tailordb`     | `TailorDBNamespaceData[]` | All namespaces with types, source info, and plugin attachments |
| `auth`         | `GeneratorAuthInput?`     | Auth configuration (machine users, OAuth2 clients, etc.)       |
| `baseDir`      | `string`                  | Output directory for generated files                           |
| `configPath`   | `string`                  | Path to `tailor.config.ts`                                     |
| `pluginConfig` | `PluginConfig`            | Plugin-level config from `definePlugins()`                     |

`TailorDBNamespaceData` contains:

| Field               | Type                                       | Description                          |
| ------------------- | ------------------------------------------ | ------------------------------------ |
| `namespace`         | `string`                                   | Namespace name                       |
| `types`             | `Record<string, TailorDBType>`             | All finalized types in the namespace |
| `sourceInfo`        | `ReadonlyMap<string, TypeSourceInfoEntry>` | Source file info for each type       |
| `pluginAttachments` | `ReadonlyMap<string, PluginAttachment[]>`  | Plugin configs attached to each type |

**Returns** (`GeneratorResult`):

| Field    | Type                                                   | Description              |
| -------- | ------------------------------------------------------ | ------------------------ |
| `files`  | `Array<{ path, content, skipIfExists?, executable? }>` | Files to write to disk   |
| `errors` | `string[]?`                                            | Error messages to report |

**Use cases**:

- Generate type definitions (e.g., Kysely types, enum constants)
- Generate seed data scaffolding from type schemas
- Generate type lists or metadata files

```typescript
onTailorDBReady(ctx) {
  const allTypes = ctx.tailordb.flatMap((ns) =>
    Object.values(ns.types).map((t) => t.name),
  );
  return {
    files: [{ path: `${ctx.baseDir}/types.ts`, content: `export const types = ${JSON.stringify(allTypes)};\n` }],
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
    types: ctx.tailordb.flatMap((ns) => Object.keys(ns.types)),
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
  PluginProcessContext,
  TypePluginOutput,
  PluginOutput,
  TailorDBReadyContext,
  ResolverReadyContext,
  ExecutorReadyContext,
  TailorDBNamespaceData,
  ResolverNamespaceData,
  GeneratorResult,
} from "@tailor-platform/sdk";
```

## getGeneratedType Helper

The SDK provides an async `getGeneratedType()` helper function to retrieve plugin-generated TailorDB types. This enables generators and other tools to work with types generated by plugins.

```typescript
import { join } from "node:path";
import { getGeneratedType } from "@tailor-platform/sdk/plugin";
import { customer } from "./tailordb/customer";

const configPath = join(import.meta.dirname, "./tailor.config.ts");

// Type-attached plugin
const DeletedCustomer = await getGeneratedType(
  configPath,
  "@example/soft-delete",
  customer,
  "archive",
);

// Namespace plugin (pass null as sourceType)
const AuditLog = await getGeneratedType(configPath, "@example/audit-log", null, "auditLog");
```

**Parameters:**

- `configPath`: Path to `tailor.config.ts` (absolute or relative to cwd)
- `pluginId`: The plugin's unique identifier (e.g., `"@example/soft-delete"`)
- `sourceType`: The TailorDB type that the plugin is attached to (`null` for namespace plugins)
- `kind`: The generated type kind (e.g., `"archive"`, `"auditLog"`)

**How it works:**

1. Loads and caches the config from the given path
2. Finds the plugin by ID from `definePlugins()` exports
3. Auto-resolves the namespace from config
4. Calls the plugin's `onTypeLoaded()` or `onNamespaceLoaded()` method
5. Caches the result to avoid redundant processing
6. Returns the generated type matching the specified kind

## Examples

### Definition-time Plugin (Soft Delete)

A plugin that adds soft delete functionality via `onTypeLoaded`:

```typescript
// plugins/soft-delete/plugin.ts
import { db } from "@tailor-platform/sdk";
import type { Plugin, PluginProcessContext, TypePluginOutput } from "@tailor-platform/sdk";

interface SoftDeleteConfig {
  archiveReason?: boolean;
  retentionDays?: number;
}

interface SoftDeletePluginConfig {
  archiveTablePrefix?: string;
  defaultRetentionDays?: number;
  requireTypeConfig?: boolean;
}

function processSoftDelete(
  context: PluginProcessContext<SoftDeleteConfig, SoftDeletePluginConfig>,
): TypePluginOutput {
  const { type, typeConfig, pluginConfig, namespace } = context;
  const prefix = pluginConfig?.archiveTablePrefix ?? "Deleted_";

  // Generate archive type
  const archiveType = db
    .type(`${prefix}${type.name}`, {
      originalId: db.uuid().description("ID of the deleted record"),
      originalData: db.string().description("JSON snapshot of deleted record"),
      deletedAt: db.datetime().description("When the record was deleted"),
      deletedBy: db.uuid().description("User who deleted the record"),
      ...(typeConfig.archiveReason && {
        reason: db.string({ optional: true }).description("Reason for deletion"),
      }),
      ...db.fields.timestamps(),
    })
    .description(`Archive for deleted ${type.name} records`);

  // Extend source type with deletedAt field
  const extendFields = {
    deletedAt: db.datetime({ optional: true }).description("Soft delete timestamp"),
  };

  return {
    types: { archive: archiveType },
    extends: { fields: extendFields },
    executors: [
      {
        name: `${type.name.toLowerCase()}-on-delete`,
        resolve: async () => await import("./executors/on-delete"),
        context: {
          sourceType: type,
          archiveType,
          namespace,
        },
      },
    ],
  };
}

function createSoftDeletePlugin(
  pluginConfig?: SoftDeletePluginConfig,
): Plugin<SoftDeleteConfig, SoftDeletePluginConfig> {
  return {
    id: "@example/soft-delete",
    description: "Adds soft delete with archive functionality",
    importPath: "./plugins/soft-delete",
    pluginConfig,
    typeConfigRequired: (config) => config?.requireTypeConfig === true,
    onTypeLoaded: processSoftDelete,
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
  sourceType: TailorAnyDBType;
  archiveType: TailorAnyDBType;
  namespace: string;
}

export default withPluginContext((ctx: SoftDeleteContext) => {
  const { sourceType, archiveType, namespace } = ctx;

  return createExecutor({
    name: `${sourceType.name.toLowerCase()}-on-delete`,
    description: `Archives deleted ${sourceType.name} records`,
    trigger: recordDeletedTrigger({ type: sourceType }),
    operation: {
      kind: "function",
      body: async ({ oldRecord, user }) => {
        const db = getDB(namespace as "tailordb");
        await db
          .insertInto(archiveType.name)
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
  .type("Customer", {
    name: db.string(),
    email: db.string(),
  })
  .plugin({
    "@example/soft-delete": {
      archiveReason: true,
    },
  });
```

### Generation-only Plugin (Type List)

A plugin that only uses `onTailorDBReady` to generate output files:

```typescript
import type { Plugin, GeneratorResult } from "@tailor-platform/sdk";

const typeListPlugin: Plugin = {
  id: "@example/type-list",
  description: "Generates a list of all TailorDB type names",

  onTailorDBReady(ctx): GeneratorResult {
    const allTypes = ctx.tailordb.flatMap((ns) =>
      Object.entries(ns.types).map(([_, type]) => ({
        name: type.name,
        fieldCount: Object.keys(type.fields).length,
        namespace: ns.namespace,
      })),
    );
    const content = `// Generated type list\nexport const types = ${JSON.stringify(allTypes, null, 2)} as const;\n`;
    return {
      files: [{ path: `${ctx.baseDir}/types.ts`, content }],
    };
  },
};
```

### Hybrid Plugin (Definition + Generation)

A plugin that uses both definition-time and generation-time hooks:

```typescript
const plugin: Plugin = {
  id: "@example/hybrid",
  description: "Generates derived types and produces output files",
  importPath: "./plugins/hybrid",

  // Definition-time: Generate additional types from attached source types
  onTypeLoaded(context) {
    return { types: { derived: createDerivedType(context.type) } };
  },

  // Generation-time: Generate output files from all finalized types
  onTailorDBReady(ctx) {
    const allTypes = ctx.tailordb.flatMap((ns) => Object.values(ns.types).map((t) => t.name));
    return {
      files: [{ path: `${ctx.baseDir}/output.ts`, content: generateCode(allTypes) }],
    };
  },
};
```

## Adding Type Safety

### Plugin-level type safety (TypeConfig / PluginConfig)

Use TypeScript type parameters on `Plugin<TypeConfig, PluginConfig>` to get type-safe config
in `onTypeLoaded` and `onNamespaceLoaded` methods:

```typescript
interface MyTypeConfig {
  archiveReason?: boolean;
}

interface MyPluginConfig {
  prefix?: string;
}

const plugin: Plugin<MyTypeConfig, MyPluginConfig> = {
  id: "@example/my-plugin",
  // ...
  onTypeLoaded(context) {
    // context.typeConfig is MyTypeConfig
    // context.pluginConfig is MyPluginConfig
  },
};
```

### Per-type `.plugin()` type safety (declaration merging)

To enable type checking when users attach plugins via `.plugin()`, provide a declaration merge
for the `PluginConfigs` interface. Plugin authors should ship this in their package's type definitions:

```typescript
// your-plugin/types.d.ts (shipped with your plugin package)
declare module "@tailor-platform/sdk" {
  interface PluginConfigs<Fields extends string> {
    "@example/soft-delete": {
      archiveReason?: boolean;
      retentionDays?: number;
    };
  }
}
```

The `Fields` type parameter provides field names from the type being configured, enabling field-aware configurations:

```typescript
declare module "@tailor-platform/sdk" {
  interface PluginConfigs<Fields extends string> {
    "@example/i18n": {
      labels: Partial<Record<Fields, { ja: string; en: string }>>;
    };
  }
}
```
