---
name: plugin
description: Use this skill when working with the @tailor-platform/sdk plugin system, including builtin plugins (kysely-type, enum-constants, file-utils, seed), custom plugin authoring, lifecycle hooks, and code generation.
metadata:
  sources:
    - docs/plugin/index.md
    - docs/plugin/custom.md
    - docs/generator/builtin.md
---

# Plugin System

Plugins extend TailorDB types by automatically generating additional types, executors, and output files based on type definitions. The plugin system runs during `tailor-sdk generate`.

## Setup: Builtin Plugins

Register plugins in `tailor.config.ts` using `definePlugins()` as a **named export** (not default):

```typescript
import { defineConfig, definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { enumConstantsPlugin } from "@tailor-platform/sdk/plugin/enum-constants";
import { fileUtilsPlugin } from "@tailor-platform/sdk/plugin/file-utils";
import { seedPlugin } from "@tailor-platform/sdk/plugin/seed";

export const plugins = definePlugins(
  kyselyTypePlugin(),
  enumConstantsPlugin(),
  fileUtilsPlugin(),
  seedPlugin({ machineUserName: "admin" }),
);

export default defineConfig({
  name: "my-app",
  // ...
});
```

### Builtin Plugin Reference

| Plugin                | Import                                       | Purpose                                                                                                                                                            |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kyselyTypePlugin`    | `@tailor-platform/sdk/plugin/kysely-type`    | Generates typed Kysely database interfaces; enables `getDB()` in resolvers, executors, and workflows. Requires `@tailor-platform/function-types` as devDependency. |
| `enumConstantsPlugin` | `@tailor-platform/sdk/plugin/enum-constants` | Extracts enum values as TypeScript constants with matching type aliases.                                                                                           |
| `fileUtilsPlugin`     | `@tailor-platform/sdk/plugin/file-utils`     | Generates file field utility interfaces for types with file-type fields.                                                                                           |
| `seedPlugin`          | `@tailor-platform/sdk/plugin/seed`           | Generates seed data JSONL files compatible with gql-ingest. Accepts `machineUserName` in config.                                                                   |

## Core Patterns: Custom Plugins

### Plugin Interface

```typescript
import type { Plugin } from "@tailor-platform/sdk";

const myPlugin: Plugin<TypeConfig, PluginConfig> = {
  id: "@my-company/my-plugin", // Required: unique identifier
  description: "...", // Required: human-readable description
  importPath: "./plugins/my-plugin", // Required when using definition-time hooks
  pluginConfig: undefined, // Set via factory function pattern
  typeConfigRequired: false, // Whether .plugin() requires per-type config

  // Definition-time hooks (run during type loading)
  onTypeLoaded: (context) => {
    /* ... */
  },
  onNamespaceLoaded: (context) => {
    /* ... */
  },

  // Generation-time hooks (run during code generation)
  onTailorDBReady: (context) => {
    /* ... */
  },
  onResolverReady: (context) => {
    /* ... */
  },
  onExecutorReady: (context) => {
    /* ... */
  },
};

export default myPlugin; // Required: must be default export
```

### Lifecycle: 5 Hooks in Fixed Order

```
tailor-sdk generate
|
+-- Load TailorDB types
|   +-- onTypeLoaded        <-- per type with .plugin() attached
|   +-- onNamespaceLoaded   <-- once per namespace (namespace plugins)
|
+-- Resolve Auth
|
+-- onTailorDBReady         <-- all types finalized; has tailordb + auth
|
+-- Load Resolvers
|
+-- onResolverReady         <-- all resolvers finalized; has tailordb + resolvers + auth
|
+-- Load Executors
|
+-- onExecutorReady         <-- all executors finalized; has tailordb + resolvers + executors + auth
```

### Definition-Time Hooks

These hooks produce TailorDB types, resolvers, and executors that become part of the application. They require `importPath` on the plugin.

**onTypeLoaded** -- called once per type with `.plugin()` attached:

```typescript
onTypeLoaded(context) {
  const { type, typeConfig, pluginConfig, namespace } = context;
  // context.type: TailorAnyDBType
  // context.typeConfig: TypeConfig (per-type config from .plugin())
  // context.pluginConfig: PluginConfig (plugin-level config from definePlugins())

  return {
    types: { archive: db.type(`Deleted_${type.name}`, { ... }) },
    extends: { fields: { deletedAt: db.datetime({ optional: true }) } },
    executors: [{
      name: `${type.name.toLowerCase()}-on-delete`,
      resolve: async () => await import("./on-delete"),
      context: { sourceType: type, namespace },
    }],
    resolvers: [],
  };
}
```

TypePluginOutput fields: `types`, `resolvers`, `executors`, `extends` (with `fields`).

**onNamespaceLoaded** -- called once per namespace for plugins without a source type:

```typescript
onNamespaceLoaded(context) {
  const { pluginConfig, namespace } = context;
  return {
    types: { auditLog: db.type("AuditLog", { action: db.string() }) },
  };
}
```

Returns `PluginOutput` (same as TypePluginOutput but without `extends`).

### Generation-Time Hooks

These hooks receive finalized data and produce output files. No `importPath` required.

All return `GeneratorResult`:

```typescript
{ files: Array<{ path: string; content: string; skipIfExists?: boolean; executable?: boolean }>, errors?: string[] }
```

**onTailorDBReady** -- receives `tailordb` (TailorDBNamespaceData[]) + `auth` + `baseDir` + `configPath` + `pluginConfig`.

**onResolverReady** -- adds `resolvers` (ResolverNamespaceData[]) to the above context.

**onExecutorReady** -- adds `executors` (Record<string, Executor>) to the above context.

### Attaching Plugins to Types

```typescript
import { db } from "@tailor-platform/sdk";

export const customer = db
  .type("Customer", {
    name: db.string(),
    email: db.string(),
  })
  .plugin({
    "@example/soft-delete": { archiveReason: true, retentionDays: 90 },
  });
```

### Factory Function Pattern for Plugin Config

```typescript
function createMyPlugin(pluginConfig?: MyPluginConfig): Plugin<MyTypeConfig, MyPluginConfig> {
  return {
    id: "@example/my-plugin",
    description: "...",
    importPath: "./plugins/my-plugin",
    pluginConfig,
    onTypeLoaded: processType,
  };
}

export default createMyPlugin();
```

Usage in config:

```typescript
export const plugins = definePlugins(createMyPlugin({ prefix: "Custom_" }));
```

### Executor Context Injection

Use `withPluginContext()` to inject context from definition-time into plugin-generated executors:

```typescript
// plugins/my-plugin/executors/on-delete.ts
import { createExecutor, recordDeletedTrigger } from "@tailor-platform/sdk";
import { withPluginContext } from "@tailor-platform/sdk/plugin";

interface MyContext {
  sourceType: TailorAnyDBType;
  namespace: string;
}

export default withPluginContext((ctx: MyContext) => {
  return createExecutor({
    name: `${ctx.sourceType.name.toLowerCase()}-on-delete`,
    trigger: recordDeletedTrigger({ type: ctx.sourceType }),
    operation: {
      kind: "function",
      body: async ({ oldRecord }) => {
        /* ... */
      },
    },
  });
});
```

### getGeneratedType() Helper

Retrieve plugin-generated types asynchronously:

```typescript
import { getGeneratedType } from "@tailor-platform/sdk/plugin";
import { join } from "node:path";
import { customer } from "./tailordb/customer";

const configPath = join(import.meta.dirname, "./tailor.config.ts");

// Type-attached plugin: pass source type
const DeletedCustomer = await getGeneratedType(
  configPath,
  "@example/soft-delete",
  customer,
  "archive",
);

// Namespace plugin: pass null as source type
const AuditLog = await getGeneratedType(configPath, "@example/audit-log", null, "auditLog");
```

Parameters: `configPath`, `pluginId`, `sourceType` (or `null`), `kind`.

### Declaration Merging for .plugin() Type Safety

Ship this in your plugin package to enable type checking on `.plugin()` calls:

```typescript
// your-plugin/types.d.ts
declare module "@tailor-platform/sdk" {
  interface PluginConfigs<Fields extends string> {
    "@example/soft-delete": {
      archiveReason?: boolean;
      retentionDays?: number;
    };
  }
}
```

The `Fields` type parameter provides field names from the type being configured, enabling field-aware configurations.

### Generated File Output

Generated files go to `.tailor-sdk/<plugin-id>/` (ID is sanitized: `@example/soft-delete` becomes `example-soft-delete`).

### Import Types

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

## Common Mistakes

### 1. Wrong lifecycle hook order (HIGH)

The 5 hooks fire in a fixed sequence: `onTypeLoaded` -> `onNamespaceLoaded` -> `onTailorDBReady` -> `onResolverReady` -> `onExecutorReady`. Do not assume you can access resolver data in `onTailorDBReady` -- resolvers are not loaded yet at that point. Use `onResolverReady` or `onExecutorReady` if you need resolver or executor data.

### 2. Confusing definition-time and generation-time hooks (HIGH)

Definition-time hooks (`onTypeLoaded`, `onNamespaceLoaded`) produce types, resolvers, and executors that become part of the app. They require `importPath` on the plugin. Generation-time hooks (`onTailorDBReady`, `onResolverReady`, `onExecutorReady`) write output files to disk and do NOT require `importPath`. Do not try to generate new TailorDB types in generation-time hooks -- they only return `GeneratorResult` with files.

### 3. Forgetting await on getGeneratedType() (MEDIUM)

`getGeneratedType()` is async. Without `await`, you get a Promise object instead of the type:

```typescript
// Wrong: returns Promise<TailorAnyDBType>
const MyType = getGeneratedType(configPath, pluginId, sourceType, "kind");

// Correct: returns TailorAnyDBType
const MyType = await getGeneratedType(configPath, pluginId, sourceType, "kind");
```

### 4. Missing declaration merging for .plugin() type safety (MEDIUM)

Without declaration merging, `.plugin()` config objects are untyped. Plugin authors must ship a `types.d.ts` with a `declare module "@tailor-platform/sdk"` block that extends `PluginConfigs<Fields>` to enable type checking for users of the plugin.

## Cross-References

- **services/tailordb**: Plugins generate artifacts based on type definitions. Definition-time hooks receive `TailorAnyDBType` and can extend types with additional fields.
- **services/executor**: Plugin-generated executors use `withPluginContext()` for context injection and standard executor triggers.
- **services/resolver**: Plugin-generated resolvers follow the same patterns as user-defined resolvers.
