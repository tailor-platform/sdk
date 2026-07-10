# @tailor-platform/eslint-plugin-sdk

Lint rules for applications built with `@tailor-platform/sdk`. The plugin uses the ESLint v9
plugin API and can run with either ESLint or Oxlint.

## Installation

Install the plugin with your linter:

```bash
pnpm add --save-dev @tailor-platform/eslint-plugin-sdk oxlint
```

## Oxlint

Add the plugin and its rules to `.oxlintrc.json`:

```json
{
  "jsPlugins": [
    {
      "name": "tailor-sdk",
      "specifier": "@tailor-platform/eslint-plugin-sdk"
    }
  ],
  "rules": {
    "tailor-sdk/no-api-prefix-in-path-pattern": "warn",
    "tailor-sdk/no-deprecated-api": "warn",
    "tailor-sdk/no-resume-after-resolve": "warn",
    "tailor-sdk/one-service-per-file": "error",
    "tailor-sdk/require-named-workflow-job-export": "error",
    "tailor-sdk/require-service-default-export": "error"
  }
}
```

Oxlint JavaScript plugins are currently alpha. These rules use syntax and import binding analysis
only; they do not require type-aware custom rule support.

## ESLint

Use the recommended flat config with ESLint v9 or later:

```js
import tailorSdk from "@tailor-platform/eslint-plugin-sdk";

export default [tailorSdk.configs.recommended];
```

## Rules

### `no-api-prefix-in-path-pattern` (warning)

HTTP adapter path patterns are matched after the platform's `/api` prefix.

Incorrect:

```ts
export default createHttpAdapter({
  pathPattern: "/api/orders/*",
});
```

Correct:

```ts
export default createHttpAdapter({
  pathPattern: "/orders/*",
});
```

### `no-deprecated-api` (warning)

Use `definePlugins()` instead of `defineGenerators()`, and pass machine-user names directly instead
of calling `auth.invoker()`.

Incorrect:

```ts
export const generators = defineGenerators(generator);

export default createResolver({
  authInvoker: auth.invoker("automation"),
});
```

Correct:

```ts
export const plugins = definePlugins(plugin);

export default createResolver({
  authInvoker: "automation",
});
```

### `no-resume-after-resolve` (warning)

Resolving a workflow wait point already resumes that execution.

Incorrect:

```ts
await approval.resolve(input.executionId, () => true);
await resumeWorkflow(input.executionId);
```

Correct:

```ts
await approval.resolve(input.executionId, () => true);
```

### `one-service-per-file` (error)

Define at most one deployable service in each file.

Incorrect:

```ts
export const createOrder = createResolver({ name: "createOrder" });
export default createResolver({ name: "cancelOrder" });
```

Correct:

```ts
export default createResolver({ name: "createOrder" });
```

### `require-named-workflow-job-export` (error)

Export every `createWorkflowJob()` result as a named export.

Incorrect:

```ts
const processOrder = createWorkflowJob({ name: "process-order" });
```

Correct:

```ts
export const processOrder = createWorkflowJob({ name: "process-order" });
```

### `require-service-default-export` (error)

Export Resolver, Executor, HTTP Adapter, and Workflow definitions as default exports.

Incorrect:

```ts
export const createOrder = createResolver({ name: "createOrder" });
```

Correct:

```ts
export default createResolver({ name: "createOrder" });
```

The rules recognize named and namespace imports from `@tailor-platform/sdk`, including local import
aliases. Same-named functions imported from other packages are ignored.

`no-resume-after-resolve` intentionally checks only direct statements in the same block. Conditional,
nested, or cross-function control flow is left to application tests and runtime validation.

For deprecated API migrations, run `tailor-sdk upgrade --from <installed-version>` to apply the SDK
codemods.
