# Plugins (Beta)

> **Beta Feature**: The plugin system is currently in beta. APIs may change in future releases.

Plugins extend TailorDB types by automatically generating additional types and executors based on your type definitions.

## Overview

When you run `tailor-sdk generate`, the SDK:

1. Loads all TailorDB types with plugin attachments
2. Passes each type to the attached plugins
3. Generates additional types and executors based on plugin output
4. Writes all generated files to the appropriate locations

This enables plugins to create derived functionality based on your application's schema.

## Configuration

### Registering Plugins

Define plugins in `tailor.config.ts` using `definePlugins()`:

```typescript
import { defineConfig, definePlugins } from "@tailor-platform/sdk";
import changesetPlugin from "@tailor-platform/sdk/plugin/changeset";

export const plugins = definePlugins(changesetPlugin);

export default defineConfig({
  name: "my-app",
  // ...
});
```

For custom plugins, import and pass the plugin object:

```typescript
import { definePlugins } from "@tailor-platform/sdk";
import myPlugin from "./plugins/my-plugin";

export const plugins = definePlugins(myPlugin);
```

**Important**: The `plugins` export must be a named export (not default).

### Built-in Plugins

The SDK includes the following built-in plugins:

| Plugin ID                    | Description                                                    |
| ---------------------------- | -------------------------------------------------------------- |
| `@tailor-platform/changeset` | Generates change request workflow types for approval processes |

### Attaching Plugins to Types

Use the `.plugin()` method to attach plugins to specific types:

```typescript
import { db } from "@tailor-platform/sdk";

export const user = db
  .type("User", {
    name: db.string(),
    email: db.string(),
  })
  .plugin({
    "@example/my-plugin": {},
  });
```

### Plugin Configuration

Some plugins accept per-type configuration:

```typescript
export const customer = db
  .type("Customer", {
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

### Per-type Config Requirement

Per-type config is optional by default. Plugin authors can change this with
`typeConfigRequired` (boolean or function). When a function is used, it receives
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

- **Types**: Additional TailorDB types (e.g., `CustomerHistory`, `Deleted_Customer`)
- **Executors**: Event handlers triggered by record changes
- **Field Extensions**: Additional fields added to the source type

Generated files are placed under `.tailor-sdk/<plugin-id>/` (the plugin ID is sanitized,
e.g. `@example/soft-delete` → `example-soft-delete`), such as:

- `.tailor-sdk/example-soft-delete/types`
- `.tailor-sdk/example-soft-delete/executors`

## Creating Custom Plugins

See [Custom Plugins](./custom.md) for how to create your own plugins.
