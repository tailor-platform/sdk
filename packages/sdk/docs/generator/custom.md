# Custom Generators (Preview)

> **Preview Feature**: The custom generator API is in preview and may change in future releases.

Create your own generators by implementing the `CodeGenerator` interface.

## CodeGenerator Interface

```typescript
interface CodeGenerator<T, R, E, Ts, Rs> {
  id: string;
  description: string;

  // Process individual items
  processType(args: {
    type: NormalizedTailorDBType;
    namespace: string;
    source: { filePath: string; exportName: string };
  }): T | Promise<T>;

  processResolver(args: { resolver: Resolver; namespace: string }): R | Promise<R>;

  processExecutor(executor: Executor): E | Promise<E>;

  // Aggregate per namespace (optional)
  processTailorDBNamespace?(args: {
    namespace: string;
    types: Record<string, T>;
  }): Ts | Promise<Ts>;

  processResolverNamespace?(args: {
    namespace: string;
    resolvers: Record<string, R>;
  }): Rs | Promise<Rs>;

  // Final aggregation
  aggregate(args: {
    input: GeneratorInput<Ts, Rs>;
    executorInputs: E[];
    baseDir: string;
  }): GeneratorResult | Promise<GeneratorResult>;
}
```

## GeneratorResult

Generators return a `GeneratorResult` containing files to create:

```typescript
interface GeneratorResult {
  files: Array<{
    path: string; // Relative path from project root
    content: string; // File content
    skipIfExists?: boolean; // Skip if file already exists (default: false)
    executable?: boolean; // Make file executable (default: false)
  }>;
  errors?: string[];
}
```

## Example: Simple Type List Generator

```typescript
import type { CodeGenerator, GeneratorResult } from "@tailor-platform/sdk";

const typeListGenerator: CodeGenerator<string, null, null, string[], null> = {
  id: "type-list",
  description: "Generates a list of all TailorDB type names",

  processType({ type }) {
    return type.name;
  },

  processResolver() {
    return null;
  },

  processExecutor() {
    return null;
  },

  processTailorDBNamespace({ types }) {
    return Object.values(types);
  },

  aggregate({ input }) {
    const allTypes = input.tailordb.flatMap((ns) => ns.types);
    const content = `// Generated type list\nexport const types = ${JSON.stringify(allTypes, null, 2)} as const;\n`;

    return {
      files: [{ path: "generated/types.ts", content }],
    };
  },
};
```

## Using Custom Generators

Pass the generator object directly to `defineGenerators()`:

```typescript
import { defineGenerators } from "@tailor-platform/sdk";
import { typeListGenerator } from "./generators/type-list";

export const generators = defineGenerators(
  ["@tailor-platform/kysely-type", { distPath: "./generated/tailordb.ts" }],
  typeListGenerator, // Custom generator
);
```

## Available Input Data

### NormalizedTailorDBType

Contains full type information including:

- `name`: Type name
- `fields`: Field definitions with types, validation, and descriptions
- `relations`: Relationship definitions
- `indexes`: Index configurations
- `permission`: Permission rules

### Resolver

Contains resolver configuration:

- `name`: Resolver name
- `operation`: Query or mutation
- `input`: Input schema
- `output`: Output schema

### Executor

Contains executor configuration:

- `name`: Executor name
- `trigger`: Trigger configuration
- `operation`: Execution target

### GeneratorAuthInput

Contains authentication configuration when available:

- `name`: Auth service name
- `userProfile`: User profile type information
- `machineUsers`: Machine user definitions
- `oauth2Clients`: OAuth2 client configurations
