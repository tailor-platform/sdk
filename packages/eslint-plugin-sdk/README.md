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
    "tailor-sdk/no-resume-after-resolve": "error",
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

| Rule                                | Recommended | Description                                                              |
| ----------------------------------- | ----------- | ------------------------------------------------------------------------ |
| `no-api-prefix-in-path-pattern`     | warning     | Rejects a literal `/api` prefix in an HTTP adapter `pathPattern`.        |
| `no-deprecated-api`                 | warning     | Rejects `defineGenerators()` and SDK Auth `invoker()` calls.             |
| `no-resume-after-resolve`           | error       | Rejects a direct `resumeWorkflow()` after resolving the same execution.  |
| `one-service-per-file`              | error       | Rejects multiple deployable service factory calls in one file.           |
| `require-named-workflow-job-export` | error       | Requires every `createWorkflowJob()` result to be a named export.        |
| `require-service-default-export`    | error       | Requires Resolver, Executor, HTTP Adapter, and Workflow default exports. |

The rules recognize named and namespace imports from `@tailor-platform/sdk`, including local import
aliases. Same-named functions imported from other packages are ignored.

`no-resume-after-resolve` intentionally checks only direct statements in the same block. Conditional,
nested, or cross-function control flow is left to application tests and runtime validation.

For deprecated API migrations, run `tailor-sdk upgrade --from <installed-version>` to apply the SDK
codemods.
