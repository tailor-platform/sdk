# Configuration

The SDK uses TypeScript for configuration files. By default, it uses `tailor.config.ts` in the project root. You can specify a different path using the `--config` option.

For service-specific documentation, see:

- [TailorDB](./services/tailordb.md) - Database schema definition
- [Resolver](./services/resolver.md) - Custom GraphQL resolvers
- [Executor](./services/executor.md) - Event-driven handlers
- [Workflow](./services/workflow.md) - Job orchestration
- [Auth](./services/auth.md) - Authentication and authorization
- [IdP](./services/idp.md) - Built-in identity provider
- [Static Website](./services/staticwebsite.md) - Static file hosting
- [Secret Manager](./services/secret.md) - Secure credential storage

To deploy the same config to multiple workspaces with per-environment values, see [Multi-Environment Configuration](./multi-environment.md).

### Application Settings

```typescript
import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  cors: ["https://example.com"],
  allowedIpAddresses: ["192.168.1.0/24"],
  disableIntrospection: false,
  metadata: { "erp-kit-version": "v1-2-3" },
  buildOptions: {
    logLevel: process.env.TAILOR_APP_LOG_LEVEL ?? "DEBUG",
  },
});
```

**Name**: Set the application name.

**Id (auto-managed)**: A stable identifier used to recognize resources managed by the SDK across renames. The SDK assigns it on the first local `deploy` and keeps it under version control for you; do not edit it by hand.

- Projects that use [`tailor setup`](./github-actions.md#app-id) keep the id in `.github/tailor.lock`, under `appIds`, keyed by the config file's path. `tailor.config.ts` itself carries no id, so a config copied inside the repository gets its own id, and configs that re-export another file work as well.
- Other projects get an `id: "<uuid>"` field written into the `defineConfig({...})` call. Delete it only if you want the SDK to assign a new id on the next `deploy` — typically when `tailor.config.ts` was copied from another project and the new application should not share the original's id. Writing the field requires `defineConfig({...})` to be called with an inline object literal: if the argument is a separate variable (e.g. `defineConfig(config)`), or if `tailor.config.ts` re-exports a config from another file, add the `id` field manually to the file that contains the actual `defineConfig({...})` object literal.

When a project starts using `tailor setup`, the next local `deploy` or `setup` moves the id from `tailor.config.ts` into the lock and removes it from the config. `AppConfig.id` stays supported: a config `id` that agrees with the lock is accepted (a local `deploy` moves it into the lock; `deploy --dry-run`, `remove`, and CI remind you to remove it), and one that disagrees stops the command so you can decide which value to keep.

**CORS**: Specify CORS settings as an array. You can also include Static Website URL references (e.g. `website.url`) in this array; see [Static Website](./services/staticwebsite.md).

**Allowed IP Addresses**: Specify IP addresses allowed to access the application in CIDR format.

**Disable Introspection**: Disable GraphQL introspection. Default is `false`.

**Metadata**: Extra labels written to the deployed application's metadata on `deploy`, alongside the labels the SDK writes itself. Use it to record information that tooling reads back from the platform, such as the version of a framework the config is generated from. Keys must match `^[a-z][a-z0-9_-]{0,62}$` and must not start with `sdk-`; values must be empty or match the same pattern, so a version like `1.2.3` is written as `v1-2-3`. At most 17 entries can be set:

```typescript
const erpKitVersion = "1.2.3";

export default defineConfig({
  name: "my-app",
  metadata: { "erp-kit-version": `v${erpKitVersion.replace(/\./g, "-")}` },
});
```

Entries are only added or overwritten. An entry removed from the config keeps its last deployed value on the platform, and labels the config does not name are left untouched. Because those retained labels count towards the platform's limit of 20 labels per resource, `deploy` reports the overflow and stops before changing the application when the labels it would leave behind exceed that limit. The labels are written when the application itself is deployed, so a config with no TailorDB, Resolver, IdP, or Auth service has no application to carry them.

**Build Options**: `buildOptions` groups the settings that control how resolvers, executors, workflow jobs, and other functions are bundled: `logLevel` (below), `inlineSourcemap` (whether bundled functions embed an inline sourcemap for readable error stack traces; default `true`), and `allowedRuntimeGlobals` (see [Node-only globals](#node-only-globals)). The top-level `logLevel` and `inlineSourcemap` fields still work but are deprecated; `tailor upgrade` moves them into `buildOptions`. Setting the same option both at the top level and in `buildOptions` is rejected.

**Log Level** (`buildOptions.logLevel`): Controls which `console.*` and `logger.*` (from `@tailor-platform/sdk/runtime`) calls are kept when deployment functions are bundled. Supported values are `"DEBUG"`, `"INFO"`, `"WARN"`, `"ERROR"`, and `"SILENT"`. The default is `"DEBUG"` and keeps all calls. `console.log` is treated as a DEBUG-level call (matching the platform's OpenTelemetry severity mapping), so it is dropped at `"INFO"` and above, alongside `console.debug` and `logger.debug`. `logger.setAttributes` has no severity and is never dropped, regardless of `logLevel`. For production deployments, use `"WARN"` to keep warn/error calls while dropping debug, log, and info calls:

```typescript
export default defineConfig({
  name: "my-app",
  buildOptions: {
    logLevel: process.env.TAILOR_APP_LOG_LEVEL ?? "DEBUG",
  },
});
```

This is a bundle-time setting. Changing `TAILOR_APP_LOG_LEVEL` affects newly bundled deployments; already deployed functions must be redeployed.

Only `logger.*` calls made through the SDK's `logger` wrapper (from `@tailor-platform/sdk/runtime` or its `@tailor-platform/sdk/runtime/logger` subpath), or written as `globalThis.tailor.logger.*`, are covered. Other equivalent forms — such as the bare `tailor.logger.*` global or `self.tailor.logger.*` — are not affected by `logLevel`.

**Date Representation** (`defaultDateRepresentation`): Sets the value representation of `t.date()`, `t.datetime()`, and `t.time()` fields that omit `as`. With `"temporal"`, those fields carry `Temporal.PlainDate`, `Temporal.Instant`, and `Temporal.PlainTime` values instead of strings, so a project that uses Temporal everywhere does not have to repeat `as: "temporal"` on every field; with `"date"`, they carry `Date` values, as `as: "date"` gives them. A field's own `as` still wins, including `as: "string"`. Run `tailor generate` after changing the setting so `tailor.d.ts` updates the field types.

```typescript
export default defineConfig({
  name: "my-app",
  defaultDateRepresentation: "temporal",
});
```

The default applies wherever the SDK parses or serializes `t` fields on your behalf: resolver input and output in deployed functions and in `tailor function run`, `.parse()` and `parseDateFields` inside any bundled function (resolvers, executors, workflow jobs, auth hooks, TailorDB hooks and validators, migration scripts), and the [`tailor-runtime` Vitest environment](./testing.md#loading-secrets-from-config) when `tailorRuntime({ config })` points at the config. It does not apply to `db.*` fields, or to `t` fields parsed outside those places, such as a plain Node.js script or a module that runs while `tailor.config.ts` itself is being loaded; there the fields keep string values. A migration script keeps the representation that was in effect when it was generated, recorded in its `diff.json`, so changing the setting later does not alter migrations a new workspace has yet to run. That record covers the values at run time only; the TypeScript types of `t` fields follow the current `tailor.d.ts` everywhere, so a `t` date field declared inside a migration script should set `as` explicitly to keep its type and its values aligned after the setting changes.

The setting is per `tailor.config.ts`, but the field types are declared through `tailor.d.ts`, which TypeScript merges across every file in a program. If one `tsconfig.json` includes the `tailor.d.ts` of several applications, they must agree on `defaultDateRepresentation`. When they differ, `t.date()`, `t.datetime()`, and `t.time()` called without `as` fail to type-check in that program until the configs are aligned or each application gets its own `tsconfig.json`.

**Maintenance Mode** (`maintenanceMode`): Whether `deploy` restricts the TailorDB namespaces it migrates while it applies pending migrations: `false` (the default) does not restrict them, `"migration"` restricts them until the migrations complete, and `"deploy"` until the whole deploy completes. See [Maintenance mode](./services/tailordb-migration.md#maintenance-mode) for what is restricted and what concurrent requests can observe without it.

```typescript
export default defineConfig({
  name: "my-app",
  maintenanceMode: "migration",
});
```

### Service Configuration

Specify glob patterns to load service files:

```typescript
export default defineConfig({
  db: {
    "my-db": {
      files: ["db/**/*.ts"],
      ignores: ["db/**/*.draft.ts"],
    },
  },
  resolver: {
    "my-resolver": {
      files: ["resolver/**/*.ts"],
      defaultPermission: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
    },
  },
  executor: {
    files: ["executors/**/*.ts"],
  },
  workflow: {
    files: ["workflows/**/*.ts"],
  },
});
```

**files**: Glob patterns to match files. Required.

**ignores**: Glob patterns to exclude files. Optional. By default, `**/*.test.ts` and `**/*.spec.ts` are automatically ignored. If you explicitly specify `ignores`, the default patterns will not be applied. Use `ignores: []` to include all files including test files.

**defaultPermission** (resolver namespaces only): Access requirement applied to every resolver in the namespace that declares no `permission` of its own. Optional, and takes the same values as a resolver's own `permission`. See [Namespace-wide default](./services/resolver.md#namespace-wide-default-defaultpermission).

**Pattern resolution**: `files` and `ignores` patterns are resolved relative to the directory of the `tailor.config.ts` file that declares them, not the directory you run the command from. This matters when deploying [multiple configs](./cli/application.md#deploy) together — each config's patterns only match files under its own directory. If a config's _relative_ patterns match nothing under its own directory, the SDK falls back to resolving them from the directory you ran the command from and logs a warning (this fallback doesn't apply to already-absolute patterns, since their resolution can't change). Update such patterns to be relative to the config's own directory — this fallback will be removed in v2.

### Bundling

Resolvers, executors, workflow jobs, auth hooks, HTTP adapters, TailorDB hooks and validators, functions, seeds, queries, and migration scripts are all bundled before running locally or deploying. Bundling honors `compilerOptions.paths` aliases declared in a `tsconfig.json`, resolved against the importing file's own nearest `tsconfig.json` (the first one found walking up from that file's directory, following its `extends` chain) — so a path alias works the same whether it is imported directly or through another aliased import.

An import that cannot be resolved fails the command instead of shipping a broken bundle, naming the specifier, the importing file, and the tsconfig the build used:

```
Error [UNRESOLVED_IMPORT]: Could not resolve "@lib/missing" imported from "/path/to/resolver.ts".
  Suggestion: Check that each import path is correct, and that a `compilerOptions.paths`
  entry covering it is declared in the importing file's own tsconfig.json or an ancestor.
  The build used "/path/to/tsconfig.json".
```

If the unresolved specifier is a Node.js built-in (e.g. `fs`, `crypto`, `path`), the suggestion explains that it is not available in the Tailor Platform runtime and, where one exists, names a Web-standard replacement (e.g. the Fetch API instead of `http`/`https`).

#### Node-only globals

The Tailor Platform runtime does not define Node-only globals such as `process`, `Buffer`, or `require`. When a bundled resolver, executor, or workflow job references one, the build fails with `FORBIDDEN_RUNTIME_GLOBAL`, naming the global and where it is referenced: the file in your own code, or the installed package (code under `node_modules`). A reference behind a `typeof` check, such as `if (typeof process !== "undefined") { ... }`, is not reported.

You cannot change an installed package's code, and it may reference a global only on a code path your use never reaches. When you have confirmed that, allow the reference with `buildOptions.allowedRuntimeGlobals`, keyed by package name. List the globals to allow, or set `true` to allow all of them, including any the package only starts referencing in a later version. Code in that package that does reach the global throws a `ReferenceError` at runtime:

```typescript
export default defineConfig({
  name: "my-app",
  buildOptions: {
    allowedRuntimeGlobals: {
      "@ai-sdk/gateway": ["Buffer"],
    },
  },
});
```

`buildOptions.allowedRuntimeGlobals` has no effect on your own code. Packages from your own workspace (for example, a pnpm or npm workspace) are bundled from their source directory rather than from `node_modules`, so they count as your own code.

### External Resources

You can reference resources managed by Terraform or other SDK projects to include them in your application's subgraph. External resources are not deployed by this project but can be used for shared access across multiple applications.

```typescript
export default defineConfig({
  name: "my-app",
  db: {
    "shared-db": { external: true },
  },
  resolver: {
    "my-resolver": { external: true },
  },
  auth: { name: "shared-auth", external: true },
  idp: [{ name: "shared-idp", external: true }],
});
```

**external**: Set to `true` to reference an external resource. The resource must already exist and be managed by another project (e.g., Terraform or another SDK application).

When using external resources:

- The resource itself is not deployed by this project
- The resource must be deployed and available before referencing it
- You can combine external resources with locally-defined resources
- TailorDB table names must remain unique across local and external TailorDB namespaces; `deploy` checks external TailorDB table names before applying changes
- Destructive operations like `tailordb truncate` (and `tailor seed apply --truncate`) automatically exclude external resources to prevent accidental data loss in shared resources
- Subscribing an executor to an external resource's events requires the config that owns the resource in the same `deploy`. Publishing is then enabled automatically, and `deploy` records the dependency so a later deploy without that config asks for confirmation instead of silently turning publishing off

### Built-in IdP

Configure the Built-in IdP service using `defineIdp()`. See [IdP](./services/idp.md) for full documentation.

```typescript
import { defineIdp } from "@tailor-platform/sdk";

const idp = defineIdp("my-idp", {
  clients: ["my-client"],
  permission: {
    create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    read: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    update: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    delete: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
    sendPasswordResetEmail: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
  },
});

export default defineConfig({
  idp: [idp],
});
```

### Auth Service

Configure Auth service using `defineAuth()`. See [Auth](./services/auth.md) for full documentation.

```typescript
import { defineAuth } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

const auth = defineAuth("my-auth", {
  userProfile: {
    type: user,
    usernameField: "email",
    attributes: { role: true },
  },
  idProvider: idp.provider("my-provider", "my-client"),
});

export default defineConfig({
  auth,
});
```

### Static Websites

Configure static website hosting using `defineStaticWebSite()`. See [Static Website](./services/staticwebsite.md) for full documentation.

```typescript
import { defineStaticWebSite } from "@tailor-platform/sdk";

const website = defineStaticWebSite("my-website", {
  description: "My Static Website",
});

export default defineConfig({
  staticWebsites: [website],
});
```

### Secret Manager

Configure secrets using `defineSecretManager()`. See [Secret Manager](./services/secret.md) for full documentation.

```typescript
import { defineSecretManager } from "@tailor-platform/sdk";

export const secrets = defineSecretManager({
  "api-keys": {
    "stripe-secret-key": process.env.STRIPE_SECRET_KEY!,
    "sendgrid-api-key": process.env.SENDGRID_API_KEY!,
  },
});

export default defineConfig({
  secrets,
});
```

### Environment Variables

Use `env` in `defineConfig()` for non-secret values that application code needs at runtime, such as environment names, feature flags, and public service URLs. Values must be strings, numbers, or booleans.

```typescript
export default defineConfig({
  name: "my-app",
  env: {
    foo: 1,
    bar: "hello",
    baz: true,
  },
});
```

A value can reference a [static website](./services/staticwebsite.md#type-safe-url-references) through its `url` property, the same reference `cors` and OAuth2 redirect URIs accept. Resolver, executor, workflow job, and auth before-login hook code, and TailorDB migration scripts, then read the deployed website URL:

```typescript
const website = defineStaticWebSite("my-frontend", { description: "Frontend" });

export default defineConfig({
  name: "my-app",
  env: {
    siteUrl: website.url, // https://my-frontend.example.com
    callbackUrl: `${website.url}/callback`, // https://my-frontend.example.com/callback
  },
  staticWebsites: [website],
});
```

This resolves even when the same deploy both creates the website and reads its URL — one `deploy` call is enough, with no second, manually-triggered `deploy` needed. If the referenced website does not exist at all, the CLI warns and leaves the unresolved reference in place. If the reference still can't be resolved after this deploy's rebuild, the deploy fails instead of shipping the unresolved reference. This platform lookup only happens during `deploy`; `function run` passes the literal `<name>:url` string unchanged, since it never talks to the platform to resolve it.

`tailor.config.ts` runs locally when an SDK command loads the config. If values come from your shell or an env file, SDK commands can load them before config evaluation with the global [`--env-file`](./cli-reference.md#environment-file-loading) and `--env-file-if-exists` options:

```typescript
export default defineConfig({
  name: "my-app",
  env: {
    foo: Number(process.env.FOO ?? "1"),
    bar: process.env.BAR ?? "hello",
    baz: (process.env.BAZ ?? "true") === "true",
  },
});
```

If the same config defines an auth before-login hook, make sure the config module can be evaluated without Node-only globals in the platform runtime. Avoid arbitrary `process.env` reads in that module; pass literal values, or values generated into a config module before deployment, and read them from the hook's `env` argument.

When the SDK deploys application code or runs detected service code with `function run`, it passes the values `tailor.config.ts` evaluated to as the `env` argument -- except a static website `<name>:url` reference, which only `deploy` resolves (see above). Do not read `process.env` from deployed resolvers, executors, workflow jobs, auth hooks, or migration scripts; Node-side environment variables are not available there. Put sensitive values in [Secret Manager](./services/secret.md) instead of `env`.

| Code location             | Runtime access                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Resolver body             | `body: ({ env }) => ...`                                                                                                                  |
| Executor callbacks        | `body: ({ env }) => ...`, `url: ({ env }) => String(env.bar)`, `variables: ({ env }) => ({ enabled: env.baz })`, or similar callback args |
| Workflow job body         | `body: (input, { env }) => ...`                                                                                                           |
| Auth before-login hook    | `handler: async ({ env }) => ...`                                                                                                         |
| TailorDB migration script | `main(trx, { env }: MigrationContext)`, or each step's `run(trx, { env })`                                                                |
| `function run`            | Same `env` argument shape as the detected resolver, executor, or workflow job                                                             |

```typescript
// In resolvers
body: ({ input, env }) => {
  return {
    result: input.multiplier * env.foo,
    message: env.bar,
    enabled: env.baz,
  };
};

// In executors
body: ({ newRecord, env }) => {
  console.log(`Environment: ${env.bar}, User: ${newRecord.name}`);
};

// In workflow jobs
body: (input, { env }) => {
  console.log(`Environment: ${env.bar}`);
  return { value: env.foo };
};

// In auth before-login hooks
hooks: {
  beforeLogin: {
    handler: async ({ claims, idpConfigName, env }) => {
      console.log(`Environment: ${env.bar}`);
    },
    invoker: "hook-invoker",
  },
};

// In TailorDB migration scripts
export async function main(trx: Transaction, { env }: MigrationContext): Promise<void> {
  if (!env.baz) return;
  await trx.updateTable("User").set({ stage: env.bar }).execute();
}
```

#### Secret Detection

`env` values are deployed as plaintext, so loading a config fails when one of them looks like a credential:

```
✖ Secret detected in 'env' in /path/to/tailor.config.ts:
  - env.SLACK_BOT_TOKEN (matched slack: SLACK_TOKEN)
    https://github.com/secretlint/secretlint/blob/master/packages/%40secretlint/secretlint-rule-slack/README.md#SLACK_TOKEN
```

Each finding names the pattern that matched and links to its description, so a value flagged as an AWS account id is distinguishable from one flagged as an AWS secret access key.

Move the value to [Secret Manager](./services/secret.md) to fix this. Detection recognizes the credential formats published by common providers, such as Slack, GitHub and AWS.

A value that is merely long and random-looking, with no recognizable provider format, is reported as a warning instead and does not fail the command.

When detection is wrong about a value, allow it in place with `allowSecretReason`, stating why the value is safe to deploy as plaintext:

```typescript
export default defineConfig({
  name: "my-app",
  env: {
    slackRelayUrl: {
      value: process.env.SLACK_RELAY_URL ?? "",
      allowSecretReason: "Public relay endpoint; the token it proxies stays in Secret Manager.",
    },
  },
});
```

This silences both the failure and the warning, so it also covers a value that is random-looking without being a credential — say so in the reason. Only string and number values accept an allowance: a boolean is never flagged, so it never needs one.

Application code still reads `env.slackRelayUrl` as the value itself: the wrapper only carries the reason and does not reach the deployed application.

### Workflow Service

Configure Workflow service by specifying glob patterns for workflow files:

```typescript
export default defineConfig({
  workflow: {
    files: ["workflows/**/*.ts"],
    ignores: ["workflows/**/*.draft.ts"],
  },
});
```

**files**: Glob patterns to match workflow files. Required.

**ignores**: Glob patterns to exclude files. Optional.

### Workflow Execution Policies

Register workspace-scoped execution policies that workflow job functions reference at runtime for per-key concurrency control. See [Execution Policies](./services/workflow.md#execution-policies) in the Workflow guide for the declaration API.

```typescript
import { defineWorkflowExecutionPolicies } from "@tailor-platform/sdk";

const executionPolicies = defineWorkflowExecutionPolicies((define) => ({
  premium: define({ concurrencyPolicy: { maxConcurrentExecutions: 5 } }),
  tenantApi: define({
    name: "tenant-api",
    matchType: "prefix",
    concurrencyPolicy: { maxConcurrentExecutions: 3 },
  }),
}));

export default defineConfig({
  workflow: {
    files: ["workflows/**/*.ts"],
    executionPolicies,
  },
});
```

### Plugins

Configure plugins using `definePlugins()`, exported as `export const plugins`.

```typescript
import { definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { enumConstantsPlugin } from "@tailor-platform/sdk/plugin/enum-constants";

export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }),
  enumConstantsPlugin({ distPath: "./generated/enums.ts" }),
);
```
