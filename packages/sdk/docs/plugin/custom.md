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

Plugins can hook into two lifecycle phases:

- **Definition-time hooks** (`onTypeLoaded`, `onNamespaceLoaded`): Generate TailorDB types, resolvers, and executors
- **Generation-time hooks** (`onTailorDBReady`, `onResolverReady`, `onExecutorReady`): Process finalized artifacts and produce output files

```typescript
interface Plugin<TypeConfig = unknown, PluginConfig = unknown> {
  /** Unique identifier for the plugin (e.g., "@my-company/soft-delete") */
  readonly id: string;

  /** Human-readable description */
  readonly description: string;

  /**
   * Import path for generated code to reference.
   * Required when plugin has definition-time hooks (onTypeLoaded/onNamespaceLoaded).
   * Optional for generation-only plugins.
   */
  readonly importPath?: string;

  /** Controls whether per-type config is required when attaching via .plugin() */
  readonly typeConfigRequired?: boolean | ((pluginConfig?: PluginConfig) => boolean);

  /** Plugin-level config passed via definePlugins() */
  readonly pluginConfig?: PluginConfig;

  // === Definition-time hooks ===

  /** Process a type with this plugin attached */
  onTypeLoaded?(
    context: PluginProcessContext<TypeConfig, PluginConfig>,
  ): TypePluginOutput | Promise<TypePluginOutput>;

  /** Process a namespace (plugins without a source type) */
  onNamespaceLoaded?(
    context: PluginNamespaceProcessContext<PluginConfig>,
  ): PluginOutput | Promise<PluginOutput>;

  // === Generation-time hooks ===

  /** Called after all TailorDB types are finalized */
  onTailorDBReady?(
    context: TailorDBReadyContext<PluginConfig>,
  ): GeneratorResult | Promise<GeneratorResult>;

  /** Called after all resolvers are finalized */
  onResolverReady?(
    context: ResolverReadyContext<PluginConfig>,
  ): GeneratorResult | Promise<GeneratorResult>;

  /** Called after all executors are finalized */
  onExecutorReady?(
    context: ExecutorReadyContext<PluginConfig>,
  ): GeneratorResult | Promise<GeneratorResult>;
}
```

Notes:

- `importPath` should be resolvable from the directory containing `tailor.config.ts`. Code generators use it to import plugin APIs such as `getGeneratedType` and executor modules.
- If you want to attach a plugin via `.plugin()`, implement the `onTypeLoaded` method.
- Namespace-only plugins implement `onNamespaceLoaded` instead.
- `pluginConfig` stores the plugin-level config so it can be read later during processing. Set it on the plugin object (e.g., via a factory function) before passing to `definePlugins()`.
- `resolve` should return a dynamic import; relative specifiers are resolved from the plugin module.
- Per-type config is optional by default. Use `typeConfigRequired: true` to make it mandatory.
- To toggle optional/required based on plugin config, provide a function for `typeConfigRequired`.
- Use TypeScript type parameters (`TypeConfig`, `PluginConfig`) to get type-safe config in your hooks.

## Definition-time Hooks

### PluginProcessContext

Context passed to the `onTypeLoaded` hook:

```typescript
interface PluginProcessContext<TypeConfig = unknown, PluginConfig = unknown> {
  /** The TailorDB type being processed */
  type: TailorAnyDBType;

  /** Per-type configuration from .plugin({ pluginId: typeConfig }) */
  typeConfig: TypeConfig;

  /** Plugin-level configuration from definePlugins() */
  pluginConfig: PluginConfig;

  /** Namespace of the TailorDB type */
  namespace: string;
}
```

### PluginNamespaceProcessContext

Context passed to the `onNamespaceLoaded` hook:

```typescript
interface PluginNamespaceProcessContext<PluginConfig = unknown> {
  /** Plugin-level configuration from definePlugins() */
  pluginConfig: PluginConfig;

  /** Target namespace for generated types */
  namespace: string;
}
```

## Generation-time Hooks

Generation-time hooks allow plugins to process finalized artifacts (types, resolvers, executors) and produce output files such as TypeScript code. These hooks replace the previous standalone `defineGenerators()` approach.

### Hook Execution Order

Hooks are executed in the following order during `tailor-sdk generate`:

1. **Phase 1**: TailorDB types loaded (definition-time hooks run during loading)
2. **Phase 2**: Auth resolved
3. **Phase 3**: `onTailorDBReady` called for TailorDB-only plugins
4. **Phase 4**: Resolvers loaded
5. **Phase 5**: `onResolverReady` called for non-executor plugins
6. **Phase 6**: Executors loaded
7. **Phase 7**: `onExecutorReady` called for executor-dependent plugins

### Dependency Auto-derivation

The pipeline determines when to run a plugin's generation hooks based on which hooks it implements:

- `onTailorDBReady` → runs after TailorDB types are finalized (Phase 3)
- `onResolverReady` → runs after resolvers are loaded (Phase 5)
- `onExecutorReady` → runs after executors are loaded (Phase 7)

### Generation-time Context Types

All generation-time context types are exported from `@tailor-platform/sdk`:

```typescript
import type {
  TailorDBReadyContext,
  ResolverReadyContext,
  ExecutorReadyContext,
  GeneratorResult,
} from "@tailor-platform/sdk";
```

### TailorDBReadyContext

```typescript
interface TailorDBReadyContext<PluginConfig = unknown> {
  /** All TailorDB namespaces with types and metadata */
  tailordb: Array<{
    namespace: string;
    types: Record<string, TailorDBType>;
    sourceInfo: ReadonlyMap<string, TypeSourceInfoEntry>;
    pluginAttachments: ReadonlyMap<string, readonly PluginAttachment[]>;
  }>;
  auth?: GeneratorAuthInput;
  baseDir: string;
  configPath: string;
  pluginConfig: PluginConfig;
}
```

### ResolverReadyContext

```typescript
interface ResolverReadyContext<PluginConfig = unknown> {
  tailordb: /* same as TailorDBReadyContext */;
  resolvers: Array<{
    namespace: string;
    resolvers: Record<string, Resolver>;
  }>;
  auth?: GeneratorAuthInput;
  baseDir: string;
  configPath: string;
  pluginConfig: PluginConfig;
}
```

### ExecutorReadyContext

```typescript
interface ExecutorReadyContext<PluginConfig = unknown> {
  tailordb: /* same as TailorDBReadyContext */;
  resolvers: /* same as ResolverReadyContext */;
  executors: Record<string, Executor>;
  auth?: GeneratorAuthInput;
  baseDir: string;
  configPath: string;
  pluginConfig: PluginConfig;
}
```

## Output Types

### PluginOutput (base)

Base output used by both `onTypeLoaded` and `onNamespaceLoaded`:

```typescript
interface PluginOutput {
  /** Additional TailorDB types to generate */
  types?: Record<string, TailorAnyDBType>;

  /** Additional resolvers to generate */
  resolvers?: PluginGeneratedResolver[];

  /** Additional executors to generate */
  executors?: PluginGeneratedExecutor[];
}
```

### TypePluginOutput

Return value from `onTypeLoaded`. Extends `PluginOutput` with the ability to add fields to the source type:

```typescript
interface TypePluginOutput extends PluginOutput {
  /** Extensions to apply to the source type */
  extends?: {
    /** Fields to add to the source type */
    fields?: Record<string, TailorAnyDBField>;
  };
}
```

`onNamespaceLoaded` returns `PluginOutput` directly (namespace plugins cannot extend a source type).

### GeneratorResult

Return value from generation-time hooks (`onTailorDBReady`, `onResolverReady`, `onExecutorReady`):

```typescript
interface GeneratorResult {
  files: Array<{
    path: string;
    content: string;
    skipIfExists?: boolean;
    executable?: boolean;
  }>;
  errors?: string[];
}
```

## getGeneratedType Helper

The SDK provides an async `getGeneratedType()` helper function to retrieve plugin-generated TailorDB types. This enables generators and other tools to work with types generated by plugins.

```typescript
import { join } from "node:path";
import { getGeneratedType } from "@tailor-platform/sdk/plugin";
import { customer } from "./tailordb/customer";

const configPath = join(import.meta.dirname, "./tailor.config.ts");

// Get the generated type by config path, plugin ID, source type, and kind
const DeletedCustomer = await getGeneratedType(
  configPath,
  "@example/soft-delete",
  customer,
  "archive",
);
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

### Example Usage

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

## Example: Soft Delete Plugin

A complete example of a plugin that adds soft delete functionality:

### Plugin Definition

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

// Factory function for plugins with plugin-level config
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

// Default export is required for getGeneratedType() to work
export default createSoftDeletePlugin();
```

### Executor with Context

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

### Usage

```typescript
// tailor.config.ts
import { definePlugins } from "@tailor-platform/sdk";
import softDeletePlugin from "./plugins/soft-delete";

// Use a factory function to pass plugin-level config
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

If your plugin uses `typeConfigRequired` as a function, you can toggle whether per-type config
is required via `pluginConfig`:

```typescript
export const plugins = definePlugins(
  softDeletePlugin({
    archiveTablePrefix: "Deleted_",
    requireTypeConfig: true,
  }),
);
```

## Example: Generation-only Plugin

A plugin that only processes loaded types and generates output files (no definition-time hooks):

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

## Adding Type Safety

Plugin type safety is provided at two levels:

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

## Plugin Types

### Type-Attached Plugins

Implement `onTypeLoaded` to handle types with the plugin attached:

```typescript
const plugin: Plugin = {
  id: "@example/my-plugin",
  // ...
  onTypeLoaded(context) {
    // Called for each type with .plugin({ "@example/my-plugin": config })
    return {
      types: {
        /* generated types */
      },
    };
  },
};
```

### Namespace Plugins

Implement `onNamespaceLoaded` for plugins that generate types independently:

```typescript
const plugin: Plugin = {
  id: "@example/audit-log",
  // ...
  onNamespaceLoaded(context) {
    // Called once per namespace, with namespace-level types available
    return { types: { auditLog: /* generated type */ } };
  },
};
```

### Hybrid Plugins

Implement both definition-time and generation-time hooks:

```typescript
const plugin: Plugin = {
  id: "@example/hybrid",
  importPath: "./plugins/hybrid",
  // Definition-time: generate types/executors
  onTypeLoaded(context) {
    return { types: { derived: createDerivedType(context.type) } };
  },
  // Generation-time: produce output files
  onTailorDBReady(ctx) {
    const allTypes = ctx.tailordb.flatMap((ns) => Object.values(ns.types).map((t) => t.name));
    return {
      files: [{ path: `${ctx.baseDir}/output.ts`, content: generateCode(allTypes) }],
    };
  },
};
```
