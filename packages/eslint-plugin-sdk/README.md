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
    "tailor-sdk/no-plain-tailor-any-field-param": "warn",
    "tailor-sdk/no-unbound-caller-id-input": "warn",
    "tailor-sdk/no-unconditional-permit": "warn",
    "tailor-sdk/no-unused-resolver-input": "warn",
    "tailor-sdk/valid-execution-policy-definition": "warn",
    "tailor-sdk/valid-resolver-permission": "warn",
    "tailor-sdk/valid-workflow-exports": "warn",
    "tailor-sdk/valid-workflow-job-definition": "warn",
    "tailor-sdk/valid-workflow-retry-policy": "warn"
  }
}
```

Oxlint JavaScript plugins are currently alpha. These rules use syntax, import binding, and scope
analysis only; they do not require type-aware custom rule support.

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
export default db.table("User", fields).permission({
  create: [{ conditions: [], permit: true }],
  // ...
});

export const defaultPermission = unsafeAllowAllTypePermission;
```

Correct:

```ts
export default db.table("User", fields).permission({
  create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
  // ...
});
```

The rule checks `.permission()` / `.gqlPermission()` on `db.table()` and `db.type()` chains and the `permission`
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

By default, both rules only act on files that define a platform function, that is, files that call
`createResolver`, `createExecutor`, `createWorkflowJob`, or `createHttpAdapter`. Configuration,
scripts, and tests are left alone, and so are helper modules imported by a function file; the build
still checks the bundled output. The messages suggest alternatives written for `body` functions, and
leave them out in a file that defines no resolver, executor, or workflow job, such as one that only
defines HTTP adapters. References that reach the global through `globalThis.process`, and
references guarded by `typeof process !== "undefined"`, are not reported.

To check helper modules as well, set the `check` option to `"all-files"` in an override whose
`files` cover the code bundled into your functions. The rules then check every file the override
matches, whether or not it defines a platform function; files outside it keep the default,
`"definition-files"`. Test files inside those directories are checked too, so turn the rules off
for them in a later override:

```json
{
  "overrides": [
    {
      "files": ["src/resolver/**", "src/executor/**", "src/lib/**"],
      "rules": {
        "tailor-sdk/no-node-builtin-imports": ["warn", { "check": "all-files" }],
        "tailor-sdk/no-node-only-globals": ["warn", { "check": "all-files" }]
      }
    },
    {
      "files": ["**/*.test.ts"],
      "rules": {
        "tailor-sdk/no-node-builtin-imports": "off",
        "tailor-sdk/no-node-only-globals": "off"
      }
    }
  ]
}
```

With ESLint, set the same options in a flat config object whose `files` cover those directories.

### `no-plain-tailor-any-field-param` (warning)

When a helper uses a field passed to a parameter typed with `TailorAnyField` itself to build another
field, such as with `t.object()`, the passed field's output type becomes `any`, so `t.infer` and
resolver `body` types stop checking it. A type parameter constrained by `TailorAnyField` keeps the
field's type.

Incorrect:

```ts
function paginated(item: Record<string, TailorAnyField>) {
  return t.object({ items: t.object(item, { array: true }), totalCount: t.int() });
}
```

Correct:

```ts
function paginated<F extends Record<string, TailorAnyField>>(item: F) {
  return t.object({ items: t.object(item, { array: true }), totalCount: t.int() });
}
```

The rule reports `TailorAnyField` in a function parameter's type, including inside arrays, unions,
object types, and type arguments such as `Record<...>`, `Map<...>`, or `Promise<...>`. It also
reports a helper that only reads the field, such as one that returns `field.metadata.description`;
the same rewrite is harmless there. Callback types, callbacks passed directly to a call such as
`.map()`, type parameter constraints, and the implementation of an overloaded function are not
reported. It does not follow type aliases or interfaces, and it does not check a function typed
through a variable annotation such as `const wrap: (field: TailorAnyField) => ...`.

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
exactly one `{ user }` operand compared to a string, a boolean, or an `{ input }` operand. `_loggedIn`
must compare to a boolean and `id` to a string or an `{ input }` operand. An `{ input }` operand is
compared with `=` and may appear only in a `permit: true` policy of a resolver's own `permission`, never in
`defaultPermission`. Whether the `{ input }` operand names a declared string, uuid, or enum input
field is left to the type checker and the build.

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

### `no-unbound-caller-id-input` (warning)

A caller can send any value for a resolver input, so a mutation that takes the acting user's ID as
input lets a caller act as another user by sending that user's ID. The rule reports a mutation's
`t.uuid()` or `db.uuid()` input named like the caller's ID, such as `approverId`, `requesterId`,
`actorId`, `currentUserId`, `createdBy`, `lastUpdatedBy`, or `created_by_id`, unless every
`permit: true` policy of the resolver's `permission` compares it with a `user` operand using `=`.
Policies are OR'd, so a policy that admits callers by role alone lets them send any ID; an omitted
`permission` or `"allowAnonymous"` compares nothing.

Incorrect:

```ts
export default createResolver({
  name: "approveRequest",
  operation: "mutation",
  input: { requestId: t.uuid(), approverId: t.uuid() },
  permission: [{ conditions: [[{ user: "role" }, "=", "MANAGER"]], permit: true }],
  body: ({ input }) => approve(input.requestId, input.approverId),
  output: t.bool(),
});
```

Correct:

```ts
export default createResolver({
  name: "approveRequest",
  operation: "mutation",
  input: { requestId: t.uuid() },
  permission: [{ conditions: [[{ user: "role" }, "=", "MANAGER"]], permit: true }],
  body: ({ input, caller }) => approve(input.requestId, caller),
  output: t.bool(),
});
```

To keep the input, add `[{ input: "approverId" }, "=", { user: "id" }]` to the conditions of every
`permit: true` policy instead. When the input names another user on purpose, such as the approver an
admin assigns, or a `permit: true` policy admits only callers trusted to act for others, suppress the
report on that input with `// oxlint-disable-next-line tailor-sdk/no-unbound-caller-id-input` (or
`eslint-disable-next-line`).

Queries, `t.string()` inputs, array inputs, fields nested in `t.object()`, and fields reused from a
TailorDB type (`user.fields.id`) are not checked. The rule reads literals and `const` values defined
in the same file, and no other check covers what it skips: an input is not reported when the rule
cannot read the resolver's options, `operation`, `input`, or the field's options, when its key is
computed or a spread follows it in `input`, or when the rule cannot read whether a `permit: true`
policy compares it. An input is still reported when one `permit: true` policy the rule can read does
not compare it, even if other policies cannot be read.

### `no-unused-resolver-input` (warning)

A resolver `input` field that `body` never reads still appears in the GraphQL schema, so a caller may
expect it to take effect. The rule reports such a field on its declaration.

Incorrect:

```ts
export default createResolver({
  name: "updateNote",
  operation: "mutation",
  input: { noteId: t.string(), note: t.string(), draft: t.bool() },
  body: ({ input }) => saveNote(input.noteId, input.note),
  output: t.bool(),
});
```

Correct:

```ts
export default createResolver({
  name: "updateNote",
  operation: "mutation",
  input: { noteId: t.string(), note: t.string() },
  body: ({ input }) => saveNote(input.noteId, input.note),
  output: t.bool(),
});
```

A field also counts as used when the resolver's `permission` compares it with the caller through an
`{ input }` operand, or when it, or a field nested in it, declares a `validate`. Reads in `body`'s
parameter defaults, such as `({ input, x = input.b }) => …`, and through a rest element, such as
`({ input: { ...args } }) => args.a`, count too.

The rule does not report a resolver when it cannot tell which fields `body` reads: `body` passes
`input`, its whole argument, or a rest element taken from either on (to another function or a
spread), reads it with a dynamic key or checks it with `in`, reads a key `input` does not declare,
such as `hasOwnProperty`, or reassigns it. Like `valid-resolver-permission`, it also skips a resolver whose config, `input`,
`body`, or `permission` it cannot read statically, and it does not report a field built by a
function of your own or imported from another module, which may declare a `validate`.

To keep an input that is ignored on purpose, disable the rule on its line:

```ts
input: {
  noteId: t.string(),
  // eslint-disable-next-line tailor-sdk/no-unused-resolver-input -- kept for older clients
  draft: t.bool(),
},
```
