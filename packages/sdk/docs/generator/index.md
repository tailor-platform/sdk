# Generators

Generators analyze your TailorDB types, Resolvers, and Executors to automatically generate TypeScript code.

## Overview

When you run `tailor-sdk generate`, the SDK:

1. Loads all TailorDB types, Resolvers, and Executors from your configuration
2. Passes each definition to the configured generators
3. Aggregates the results and writes output files

This enables generators to create derived code based on your application's schema. For example, the `@tailor-platform/kysely-type` generator produces type-safe database access code from your TailorDB definitions.

## Configuration

Define generators in `tailor.config.ts` using `defineGenerators()`:

```typescript
import { defineConfig, defineGenerators } from "@tailor-platform/sdk";

export const generators = defineGenerators(
  ["@tailor-platform/kysely-type", { distPath: "./generated/tailordb.ts" }],
  ["@tailor-platform/enum-constants", { distPath: "./generated/enums.ts" }],
);

export default defineConfig({
  name: "my-app",
  // ...
});
```

**Important**: The `generators` export must be a named export (not default).

## CLI Commands

### Generate Files

```bash
tailor-sdk generate
```

Generates all configured output files.

### Watch Mode

```bash
tailor-sdk generate --watch
```

Watches for file changes and regenerates automatically.

## Generator Types

- [Builtin Generators](./builtin.md) - Ready-to-use generators included with the SDK
- [Custom Generators](./custom.md) - Create your own generators (Preview)
