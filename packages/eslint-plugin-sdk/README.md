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
    "tailor-sdk/no-direct-exec-job-function": "warn",
    "tailor-sdk/no-execute-script-arg-stringify": "warn",
    "tailor-sdk/no-job-start-outside-body": "warn",
    "tailor-sdk/no-node-builtin-imports": "warn",
    "tailor-sdk/no-node-only-globals": "warn",
    "tailor-sdk/no-unconditional-permit": "warn",
    "tailor-sdk/valid-execution-policy-definition": "warn",
    "tailor-sdk/valid-resolver-permission": "warn",
    "tailor-sdk/valid-workflow-exports": "warn",
    "tailor-sdk/valid-workflow-job-definition": "warn",
    "tailor-sdk/valid-workflow-retry-policy": "warn"
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

### `no-execute-script-arg-stringify` (warning)

`executeScript`'s `arg` option is serialized internally, so passing an already-stringified value
double-encodes it.

Incorrect:

```ts
await executeScript({ ...opts, arg: JSON.stringify({ a: 1 }) });
```

Correct:

```ts
await executeScript({ ...opts, arg: { a: 1 } });
```

The rule follows `arg` through a `const` variable (including one holding the `JSON.stringify(...)`
call itself) to catch indirect forms, and recognizes named and namespace imports of `executeScript`
from `@tailor-platform/sdk/cli`.

### `no-unconditional-permit` (warning)

Permission entries with empty `conditions` and `permit: true` grant access to every request, as do
the `unsafeAllowAll*` constants. Use them only during local development.

Incorrect:

```ts
export default db.type("User", fields).permission({
  create: [{ conditions: [], permit: true }],
  // ...
});

export const defaultPermission = unsafeAllowAllTypePermission;
```

Correct:

```ts
export default db.type("User", fields).permission({
  create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
  // ...
});
```

The rule checks `.permission()` / `.gqlPermission()` on `db.type()` chains and the `permission`
option of `defineIdp()`, including values defined as `const` in the same file.

### `valid-workflow-job-definition` (warning)

The build detects workflow jobs by reading `createWorkflowJob` calls statically: the options must be
an inline object literal, `name` must be a string literal, and `body` must be an inline function
expression. Anything else fails `tailor generate` / `tailor deploy`.

Incorrect:

```ts
const options = { name: "sync", body: syncProfile };
export const sync = createWorkflowJob(options);

export const notify = createWorkflowJob({
  name: `notify-${channel}`,
  body: withLogging(notifyUser),
});
```

Correct:

```ts
export const sync = createWorkflowJob({
  name: "sync",
  body: async (input: { userId: string }) => syncProfile(input.userId),
});
```

### `no-job-start-outside-body` (warning)

Job dependencies are collected from `.start()` calls that sit lexically inside a job's `body`. A
call factored into a function defined outside the body is not detected and fails the build.

Incorrect:

```ts
function fetchAll(ids: string[]) {
  return ids.map((id) => fetchCustomer.start({ id }));
}

export const processOrder = createWorkflowJob({
  name: "process-order",
  body: (input: { customerIds: string[] }) => fetchAll(input.customerIds),
});
```

Correct:

```ts
export const processOrder = createWorkflowJob({
  name: "process-order",
  body: (input: { customerIds: string[] }) => {
    const fetchAll = (ids: string[]) => ids.map((id) => fetchCustomer.start({ id }));
    return fetchAll(input.customerIds);
  },
});
```

The rule only checks `.start()` calls on a `const` initialized with `createWorkflowJob` in the same
file. A job imported from another module cannot be told apart from an unrelated `.start()` method,
so such calls are not reported; the build still rejects them. Test files
that define jobs inline and start them directly can turn this rule off for `**/*.test.ts`.

### `no-direct-exec-job-function` (warning)

`.start()` calls are rewritten to `execJobFunction` at build time, and only those rewritten calls are
recognized as job dependencies. Calling `execJobFunction` yourself, on the ambient `tailor.workflow`
global or on the `workflow` value from `@tailor-platform/sdk/runtime`, drops the target job from the
bundle; the build rejects the forms it can detect.

Incorrect:

```ts
import { workflow } from "@tailor-platform/sdk/runtime";

export const parent = createWorkflowJob({
  name: "parent",
  body: () => workflow.execJobFunction("child", {}),
});
```

Correct:

```ts
export const parent = createWorkflowJob({
  name: "parent",
  body: () => child.start({}),
});
```

### `valid-workflow-exports` (warning)

The build loads a workflow file's default export as the workflow and every named export as a job. A
`createWorkflow` result that is not the default export is never deployed, and a job that is not a
named export is never bundled; swapping the two fails to load the file.

Incorrect:

```ts
const validate = createWorkflowJob({ name: "validate", body: () => true });

export const workflow = createWorkflow({ name: "orders", mainJob: validate });
```

Correct:

```ts
export const validate = createWorkflowJob({ name: "validate", body: () => true });

export default createWorkflow({ name: "orders", mainJob: validate });
```

`export default workflow` and `export { job }` forms are accepted as well. Calls inside functions
(job factories) are not checked because the exported value cannot be traced statically. Test files
that define jobs inline without exporting them can turn this rule off for `**/*.test.ts`.

### `no-node-only-globals` (warning)

The Tailor Platform runtime does not define Node-only globals such as `process`, `Buffer`,
`__dirname`, `require`, or `setImmediate`. The build rejects bundled resolvers, executors, and
workflow jobs that still reference one; this rule reports the reference in source, with the same
suggested alternative the build prints.

Incorrect:

```ts
export default createResolver({
  name: "region",
  body: () => process.env.REGION,
});
```

Correct:

```ts
export default createResolver({
  name: "region",
  body: (_input, { env }) => env.REGION,
});
```

### `no-node-builtin-imports` (warning)

Node built-in modules (`node:fs`, `path`, `crypto`, `http`, ...) cannot be bundled for the Tailor
Platform runtime. The rule reports static imports, re-exports, and `import("...")` calls of a
built-in module, with the same Web Standard alternative the build suggests. Type-only imports are
ignored.

Incorrect:

```ts
import { createHash } from "node:crypto";
```

Correct:

```ts
const digest = await crypto.subtle.digest("SHA-256", data);
```

Both rules only act on files that define a platform function, that is, files that call
`createResolver`, `createExecutor`, `createWorkflowJob`, or `createHttpAdapter`. Configuration,
scripts, and tests are left alone, and so are helper modules imported by a function file; the build
still checks the bundled output. In a file that only defines HTTP adapters the messages omit the
suggestions, which are written for `body` functions. References that reach the global through
`globalThis.process`, and references guarded by `typeof process !== "undefined"`, are not reported.

### `valid-execution-policy-definition` (warning)

Workflow execution policy names must match `[a-z0-9-]` (3-63 characters, starting and ending with
`[a-z0-9]`), and keys must match `[a-z0-9_:.-]` (2-64 characters); a `matchType: "prefix"` policy
gets `*` appended by the SDK, so the declared key must not end with `*`. The deploy validates these
with Zod; this rule checks the literal values in `defineWorkflowExecutionPolicies` /
`defineWorkflowExecutionPolicy`, including names derived from the property name.

Incorrect:

```ts
export const policies = defineWorkflowExecutionPolicies((define) => ({
  tenantApi: define({ matchType: "prefix" }), // name "tenantApi" has an uppercase letter
}));
```

Correct:

```ts
export const policies = defineWorkflowExecutionPolicies((define) => ({
  tenantApi: define({ name: "tenant-api", matchType: "prefix" }),
}));
```

### `valid-workflow-retry-policy` (warning)

A `createWorkflow` `retryPolicy` written with literal values must satisfy the platform limits:
`initialBackoff` at most `maxBackoff`, durations positive and at most 1h / 24h, `maxRetries` an
integer from 1 to 10, and `backoffMultiplier` at least 1.

Incorrect:

```ts
retryPolicy: { maxRetries: 3, initialBackoff: "2m", maxBackoff: "30s", backoffMultiplier: 2 }
```

Correct:

```ts
retryPolicy: { maxRetries: 3, initialBackoff: "1s", maxBackoff: "30s", backoffMultiplier: 2 }
```

### `valid-resolver-permission` (warning)

A literal resolver `permission` (or a namespace `defaultPermission` in `defineConfig`) must contain
at least one policy with `permit: true`, every policy at least one condition, and every condition
exactly one `{ user }` operand compared to a string or a boolean. `_loggedIn` must compare to a
boolean and `id` to a string.

Incorrect:

```ts
permission: [{ conditions: [[{ user: "role" }, "=", { user: "team" }]], permit: false }];
```

Correct:

```ts
permission: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }];
```

These three rules only check values they can read statically: literals, and `const` values defined
in the same file. Values built by function calls, spread into an object or array, or imported from
another module are skipped and still validated by the build.

The rules recognize named and namespace imports from `@tailor-platform/sdk`, including local import
aliases. Same-named functions imported from other packages are ignored.
