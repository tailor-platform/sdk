# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development

- `turbo run gen` - Run code generation for Tailor SDK components
- `turbo run gen:watch` - Run code generation in watch mode
- `turbo run apply` - Deploy to Tailor Platform (requires TAILOR_ACCESS_TOKEN)
- `turbo run dev` - Start development server
- `turbo run test` - Run all tests using Turbo
- `turbo run test:root` - Run tests in root directory only
- `turbo run lint` - Run ESLint
- `turbo run lint:fix` - Run ESLint with auto-fix
- `turbo run format` - Format code with Prettier
- `turbo run typecheck` - Run TypeScript type checking

## Architecture Overview

This is a **monorepo** for the Tailor SDK, which enables building applications on the Tailor Platform. The main SDK package(`@tailor-platform/tailor-sdk`) is located at `packages/tailor-sdk`.

### Key Components

1. **TailorDB** (`src/tailordb/`)

   - Define type-safe database models using `db.type()`
   - Always export both the value and type: `export const model = db.type(...); export type model = typeof model;`
   - Use `db.fields.timestamps()` for automatic timestamp fields
   - Relations are defined with `.relation()` method

2. **Pipeline Resolvers** (`src/resolvers/`)

   - Create GraphQL resolvers using `createQueryResolver` or `createMutationResolver`
   - Use step-based flow: `.fnStep()`, `.sqlStep()`, etc.
   - Each step's result is available in subsequent steps via context
   - Define return type with `.returns()`

3. **Executors** (`src/executors/`)

   - Event-driven handlers using `createExecutor()`
   - Trigger on record changes: `recordCreatedTrigger`, `recordUpdatedTrigger`, `recordDeletedTrigger`
   - Execute functions, webhooks, or GraphQL operations

4. **Configuration** (`tailor.config.ts`)
   - Central configuration using `defineConfig()`
   - Specify component locations with glob patterns
   - Configure generators for code generation

### Code Patterns

**Model Definition Pattern:**

```typescript
import { db } from "@tailor-platform/tailor-sdk";

export const modelName = db.type("ModelName", {
  field: db.string(),
  relatedId: db
    .uuid()
    .relation({ type: "1-n", toward: { type: relatedModel } }),
  ...db.fields.timestamps(),
});
export type modelName = typeof modelName;
```

**Resolver Pattern:**

```typescript
export default createQueryResolver("name", inputType, options)
  .fnStep("stepName", (context) => {
    /* logic */
  })
  .returns((context) => ({ result: context.stepName }), outputType);
```

**Executor Pattern:**

```typescript
export default createExecutor("name", "description")
  .on(recordCreatedTrigger(model))
  .executeFunction(handler);
```

### Important Notes

- This project uses ESM modules and requires Node.js 22.14.0+
- TypeScript is configured in strict mode
- Lefthook runs pre-commit checks automatically
- Always use parameterized queries to prevent SQL injection
- The SDK uses Rolldown for bundling and Turbo for task orchestration
- Kysely is integrated for type-safe SQL query building
