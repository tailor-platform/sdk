# Custom Plugins (Beta)

> **Beta Feature**: The custom plugin API is in beta and may change in future releases.

Create your own plugins by implementing the `PluginBase` interface.

## PluginBase Interface

```typescript
interface PluginBase<PluginConfig = unknown> {
  /** Unique identifier for the plugin (e.g., "@my-company/soft-delete") */
  readonly id: string;

  /** Human-readable description */
  readonly description: string;

  /** Import path for generated code to reference */
  readonly importPath: string;

  /** Schema for per-type configuration via .plugin() */
  readonly configSchema: TailorAnyField;

  /** Schema for global configuration via definePlugins() (optional) */
  readonly pluginConfigSchema?: TailorAnyField;

  /** Process a type with this plugin attached */
  process?(context: PluginProcessContext): PluginOutput | Promise<PluginOutput>;

  /** Process without a source type (standalone plugins) */
  processStandalone?(context: StandalonePluginProcessContext): PluginOutput | Promise<PluginOutput>;
}
```

## PluginProcessContext

Context passed to the `process` method:

```typescript
interface PluginProcessContext<Config = unknown, PluginConfig = unknown> {
  /** The TailorDB type being processed */
  type: TailorAnyDBType;

  /** Per-type configuration from .plugin({ pluginId: config }) */
  config: Config;

  /** Global configuration from definePlugins() */
  pluginConfig: PluginConfig;

  /** Namespace of the TailorDB type */
  namespace: string;
}
```

## PluginOutput

Return value from `process` and `processStandalone`:

```typescript
interface PluginOutput {
  /** Additional TailorDB types to generate */
  types?: Record<string, TailorAnyDBType>;

  /** Additional resolvers to generate */
  resolvers?: PluginGeneratedResolver[];

  /** Additional executors to generate */
  executors?: PluginGeneratedExecutor[];

  /** Extensions to apply to the source type */
  extends?: {
    /** Fields to add to the source type */
    fields?: Record<string, TailorAnyField>;
  };
}
```

## Example: Soft Delete Plugin

A complete example of a plugin that adds soft delete functionality:

### Plugin Definition

```typescript
// plugins/soft-delete/plugin.ts
import { db, t } from "@tailor-platform/sdk";
import type { PluginBase, PluginProcessContext, PluginOutput } from "@tailor-platform/sdk";

interface SoftDeleteConfig {
  archiveReason?: boolean;
  retentionDays?: number;
}

interface SoftDeletePluginConfig {
  archiveTablePrefix?: string;
  defaultRetentionDays?: number;
}

const configSchema = t.object({
  archiveReason: t.bool({ optional: true }),
  retentionDays: t.int({ optional: true }),
});

const pluginConfigSchema = t.object({
  archiveTablePrefix: t.string({ optional: true }),
  defaultRetentionDays: t.int({ optional: true }),
});

function processSoftDelete(
  context: PluginProcessContext<SoftDeleteConfig, SoftDeletePluginConfig>,
): PluginOutput {
  const { type, config, pluginConfig, namespace } = context;
  const prefix = pluginConfig?.archiveTablePrefix ?? "Deleted_";

  // Generate archive type
  const archiveType = db
    .type(`${prefix}${type.name}`, {
      originalId: db.uuid().description("ID of the deleted record"),
      originalData: db.string().description("JSON snapshot of deleted record"),
      deletedAt: db.datetime().description("When the record was deleted"),
      deletedBy: db.uuid().description("User who deleted the record"),
      ...(config.archiveReason && {
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
        executorExport: "onDelete",
        context: {
          sourceType: type,
          archiveType,
          namespace,
        },
      },
    ],
  };
}

// Factory function for plugins with global config
export function softDeletePlugin(pluginConfig?: SoftDeletePluginConfig): PluginBase {
  return {
    id: "@example/soft-delete",
    description: "Adds soft delete with archive functionality",
    importPath: "./plugins/soft-delete",
    configSchema,
    pluginConfigSchema,
    _pluginConfig: pluginConfig,
    process: processSoftDelete,
  };
}
```

### Executor with Context

```typescript
// plugins/soft-delete/executors/on-delete.ts
import { createExecutor, recordDeletedTrigger, withPluginContext } from "@tailor-platform/sdk";
import type { TailorAnyDBType } from "@tailor-platform/sdk";
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
import { softDeletePlugin } from "./plugins/soft-delete";

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

## Adding Type Safety

To enable type checking for your plugin's configuration, add a declaration merge:

```typescript
// user-defined.d.ts or your plugin's types.ts
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

Implement `process` to handle types with the plugin attached:

```typescript
const plugin: PluginBase = {
  id: "@example/my-plugin",
  // ...
  process(context) {
    // Called for each type with .plugin({ "@example/my-plugin": config })
    return {
      types: {
        /* generated types */
      },
    };
  },
};
```

### Standalone Plugins

Implement `processStandalone` for plugins that generate types independently:

```typescript
const plugin: PluginBase = {
  id: "@example/audit-log",
  // ...
  processStandalone(context) {
    // Called once per namespace
    return { types: { auditLog: /* generated type */ } };
  },
};
```

### Hybrid Plugins

Implement both methods for plugins that support both modes:

```typescript
const plugin: PluginBase = {
  id: "@example/hybrid",
  // ...
  process(context) {
    // Handle type attachments
  },
  processStandalone(context) {
    // Handle standalone generation
  },
};
```

## Best Practices

1. **Use factory functions** for plugins with global configuration
2. **Validate configuration** using `configSchema` and `pluginConfigSchema`
3. **Use `withPluginContext`** for type-safe executor definitions
4. **Generate meaningful names** that include the source type name
5. **Add TypeScript declarations** for configuration type safety
6. **Document your plugin** with JSDoc comments and examples

## Limitations (Beta)

- Plugin execution order is not guaranteed
- Circular dependencies between plugins are not detected
- Error messages may not always indicate the source plugin
- Hot reload in watch mode may require manual restart for plugin changes
