---
name: tailor-sdk/code-generation
description: >
  Generate TypeScript types from TailorDB definitions using plugins.
  Covers kyselyTypePlugin, enumConstantsPlugin, fileUtilsPlugin,
  seedPlugin, getDB() for type-safe Kysely database access,
  tailor-sdk generate command, @tailor-platform/function-types
  devDependency requirement.
type: sub-skill
library: tailor-sdk
library_version: "1.25.1"
sources:
  - "tailor-platform/sdk:packages/sdk/docs/generator/index.md"
  - "tailor-platform/sdk:packages/sdk/docs/generator/builtin.md"
  - "tailor-platform/sdk:packages/sdk/src/plugin/builtin/kysely-type/index.ts"
---

This skill builds on tailor-sdk and tailor-sdk/model-definition. Read those first.

# Code Generation

## Setup

1. Configure plugins in `tailor.config.ts`:

```typescript
import { definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

export const plugins = definePlugins(kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }));
```

2. Install the required devDependency:

```bash
pnpm add -D @tailor-platform/function-types
```

3. Run generation:

```bash
tailor-sdk generate
```

This produces `./generated/tailordb.ts` with type-safe Kysely database types.

## Core Patterns

### Using getDB() in resolvers, executors, and workflows

```typescript
import { getDB } from "../generated/tailordb";

const db = getDB("tailordb");

const users = await db
  .selectFrom("User")
  .select(["id", "email", "name"])
  .where("role", "=", "ADMIN")
  .execute();
```

The namespace name (`"tailordb"`) must match the key in `defineConfig().db`, not a type name.

### Watch mode for development

```bash
tailor-sdk generate --watch
```

Regenerates types automatically when model definitions change.

### Multiple plugins

```typescript
import { definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { enumConstantsPlugin } from "@tailor-platform/sdk/plugin/enum-constants";
import { seedPlugin } from "@tailor-platform/sdk/plugin/seed";

export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }),
  enumConstantsPlugin({ distPath: "./generated/enums.ts" }),
  seedPlugin({ distPath: "./seed", machineUserName: "admin-machine-user" }),
);
```

## Common Mistakes

### HIGH Missing @tailor-platform/function-types devDependency

Wrong:

```typescript
// package.json has no @tailor-platform/function-types
import { getDB } from "../generated/tailordb";
const db = getDB("tailordb"); // Type error: cannot find types
```

Correct:

```bash
pnpm add -D @tailor-platform/function-types
```

```typescript
import { getDB } from "../generated/tailordb";
const db = getDB("tailordb"); // Works
```

getDB() depends on types from @tailor-platform/function-types. Without it, TypeScript compilation fails.

Source: docs/generator/builtin.md

### HIGH Wrong namespace name in getDB()

Wrong:

```typescript
const db = getDB("User"); // Wrong — "User" is a type name
```

Correct:

```typescript
// Given config: db: { tailordb: { files: ["./tailordb/*.ts"] } }
const db = getDB("tailordb"); // Correct — namespace name from config
```

getDB() takes the TailorDB namespace name from defineConfig().db, not a type name.

Source: example/workflows/sample.ts

### HIGH Using unsupported Kysely query features

Wrong:

```typescript
const result = await db
  .with("cte", (qb) => qb.selectFrom("Order").selectAll())
  .selectFrom("cte")
  .selectAll()
  .execute();
```

Correct:

```typescript
const result = await db
  .selectFrom("Order")
  .selectAll()
  .where("status", "=", "active")
  .orderBy("createdAt", "desc")
  .execute();
```

Kysely allows writing complex SQL (WITH, CTEs, window functions) but the Tailor Platform backend does not support all SQL features. Use simple SELECT, INSERT, UPDATE, DELETE with WHERE, JOIN, ORDER BY, LIMIT.

Source: maintainer interview

### MEDIUM Importing getDB before running generate

The generated file does not exist until `tailor-sdk generate` runs. Always run generate before writing code that imports from `generated/`.

Source: docs/services/workflow.md

### HIGH Tension: Type safety strictness vs rapid prototyping

Generated Kysely types enforce strict schemas but require running `tailor-sdk generate` before code that imports them compiles. When adding new models, run generate first, then write resolver/workflow code.

See also: tailor-sdk/model-definition/SKILL.md — models feed into code generation
See also: tailor-sdk/resolver/SKILL.md — resolvers use getDB()
See also: tailor-sdk/workflow/SKILL.md — workflows use getDB()
