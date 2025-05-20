# Rollup Configuration and Usage Guide for Tailor SDK

This document explains how to use Rollup as the build process for Tailor SDK, detailing the configurations, plugins, and execution commands.

## Execution Commands

Basic command to run Rollup:

```bash
# From project root
npx rollup -c ./packages/tailor-sdk/rollup.config.mjs

# From packages/tailor-sdk directory
npx rollup -c rollup.config.mjs
```

To run in watch mode (auto-rebuild on changes):

```bash
npx rollup -c ./packages/tailor-sdk/rollup.config.mjs --watch
```

## Configuration Overview

The Rollup configuration for Tailor SDK is defined in `rollup.config.mjs` and includes:

### Input/Output Configuration

- **Input**: Source files containing resolver/queryResolver calls
  ```js
  input: [
    './src/resolvers/hello-world.ts',
    './src/resolvers/order-summary.ts'
  ]
  ```

- **Output**: ES modules in the `dist` directory with sourcemaps
  ```js
  output: {
    dir: 'dist',
    format: 'esm',
    sourcemap: true,
    hoistTransitiveImports: false,
    interop: 'auto'
  }
  ```

### Custom Plugins

Tailor SDK uses several custom plugins to handle TypeScript decorators and resolver functions:

1. **resolverEntry** - Detects files containing resolver/queryResolver calls and adds them as entry points
2. **resolverRemover** - Removes resolver calls from the compiled code
3. **decorator-remover** - Removes TypeScript decorator syntax

### Standard Plugins

1. **@rollup/plugin-replace** - Replaces remaining decorator syntax with empty strings
2. **rollup-plugin-esbuild** - Transpiles TypeScript to JavaScript
3. **@rollup/plugin-node-resolve** - Resolves dependencies from node_modules
4. **@rollup/plugin-commonjs** - Converts CommonJS modules to ES modules

## Plugin Details

### resolverEntry

Located in `rollup-plugin-resolver-entry.mjs`, this plugin:
- Scans code for `resolver()` and `queryResolver()` function calls
- Adds files containing these calls as entry points
- Helps handle decorator removal in TypeScript files

### resolverRemover

Located in `rollup-plugin-resolver-remover.mjs`, this plugin:
- Removes resolver/queryResolver variable definitions
- Removes export default statements for resolver variables
- Only processes TypeScript files (.ts and .tsx)

### decorator-remover

Located in `rollup-plugin-decorator-remover.mjs`, this plugin:
- Removes TypeScript decorator syntax (@InputType(), @TypeField(), etc.)
- Preserves the underlying class and property definitions
- Uses MagicString for precise source code transformations

## Build Process

1. **Decorator and Import Processing**:
   - Remove unnecessary imports from @tailor-platform/tailor-sdk
   - Process and remove TypeScript decorators

2. **Resolver Call Processing**:
   - Identify files with resolver calls
   - Remove resolver calls while preserving the structure

3. **TypeScript Compilation**:
   - Transpile TypeScript to JavaScript with esbuild
   - Configure TypeScript to not emit decorator metadata

4. **Output Optimization**:
   - Remove unused imports and variables
   - Clean up redundant empty lines
   - Special handling for specific files (like hello-world.js)

## Notes

- TypeScript decorators and resolver calls are removed from the final build
- Unused imports are automatically removed
- The `dist` directory may be cleared before building
- Source maps are generated to aid debugging

## Example Generated Output

After processing a TypeScript file with decorators and resolvers:

```typescript
// Input: hello-world.ts
import { resolver, functionStep, InputType, InputTypeField, Type, TypeField } from '@tailor-platform/tailor-sdk';

@InputType()
export class HelloWorldInput {
  @InputTypeField()
  public name?: string;
}

@Type()
export class HelloWorldOutput {
  @TypeField()
  message?: string;
}

function processHello(input: HelloWorldInput): HelloWorldOutput {
  return { 
    message: `Hello, ${input.name || 'World'}!` 
  };
}

export const helloWorld = resolver(
  "helloWorld",
  functionStep("process", processHello)
);
```

```javascript
// Output: hello-world.js
export class HelloWorldInput {
  name;
}

export class HelloWorldOutput {
  message;
}

function processHello(input) {
  return {
    message: `Hello, ${input.name || 'World'}!`
  };
}

export { HelloWorldInput, HelloWorldOutput };
```