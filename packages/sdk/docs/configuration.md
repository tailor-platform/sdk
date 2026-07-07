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
  // SDK-managed app id — do not edit, except when copying this config to a separate app.
  // id: "<uuid>" — written here automatically on first run
  name: "my-app",
  cors: ["https://example.com"],
  allowedIpAddresses: ["192.168.1.0/24"],
  disableIntrospection: false,
  logLevel: process.env.LOG_LEVEL ?? "DEBUG",
});
```

**Name**: Set the application name.

**Id (auto-managed)**: A stable identifier used to recognize resources managed by the SDK across renames. On first `deploy`, the SDK injects an `id: "<uuid>"` field into your `defineConfig({...})` call and commits it to `tailor.config.ts`. Keep it under version control; do not edit it by hand. Delete it only if you want the SDK to assign a new id on the next `deploy` — typically when `tailor.config.ts` was copied from another project and the new application should not share the original's id. Auto-injection requires `defineConfig({...})` to be called with an inline object literal: if the argument is a separate variable (e.g. `defineConfig(config)`), or if `tailor.config.ts` is a wrapper that re-exports `defineConfig` from another file, the SDK cannot inject — add the `id` field manually to the file that contains the actual `defineConfig({...})` object literal.

**CORS**: Specify CORS settings as an array. You can also include Static Website URL references (e.g. `website.url`) in this array; see [Static Website](./services/staticwebsite.md).

**Allowed IP Addresses**: Specify IP addresses allowed to access the application in CIDR format.

**Disable Introspection**: Disable GraphQL introspection. Default is `false`.

**Log Level**: Controls which `console.*` calls are kept when deployment functions are bundled. Supported values are `"DEBUG"`, `"INFO"`, `"WARN"`, `"ERROR"`, and `"SILENT"`. The default is `"DEBUG"` and keeps all console calls. `console.log` is treated as a DEBUG-level call (matching the platform's OpenTelemetry severity mapping), so it is dropped at `"INFO"` and above. For production deployments, use `"WARN"` to keep `console.warn` and `console.error` while dropping debug, log, and info calls:

```typescript
export default defineConfig({
  name: "my-app",
  logLevel: process.env.LOG_LEVEL ?? "DEBUG",
});
```

This is a bundle-time setting. Changing `LOG_LEVEL` affects newly bundled deployments; already deployed functions must be redeployed.

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
- TailorDB type names must remain unique across local and external TailorDB namespaces; `deploy` checks external TailorDB type names before applying changes
- Destructive operations like `tailordb truncate` (and `seedPlugin`'s `seed:reset`) automatically exclude external resources to prevent accidental data loss in shared resources

### Built-in IdP

Configure the Built-in IdP service using `defineIdp()`. See [IdP](./services/idp.md) for full documentation.

```typescript
import { defineIdp } from "@tailor-platform/sdk";

const idp = defineIdp("my-idp", {
  clients: ["my-client"],
  permission: {
    create: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
    read: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
    update: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
    delete: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
    sendPasswordResetEmail: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
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

When the SDK deploys application code or runs detected service code with `function test-run`, it passes the resolved values as the `env` argument. Do not read `process.env` from deployed resolvers, executors, workflow jobs, auth hooks, or migration scripts; Node-side environment variables are not available there. Put sensitive values in [Secret Manager](./services/secret.md) instead of `env`.

| Code location             | Runtime access                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Resolver body             | `body: ({ env }) => ...`                                                                                                                  |
| Executor callbacks        | `body: ({ env }) => ...`, `url: ({ env }) => String(env.bar)`, `variables: ({ env }) => ({ enabled: env.baz })`, or similar callback args |
| Workflow job body         | `body: (input, { env }) => ...`                                                                                                           |
| Auth before-login hook    | `handler: async ({ env }) => ...`                                                                                                         |
| TailorDB migration script | `main(trx, { env }: MigrationContext)`                                                                                                    |
| `function test-run`       | Same `env` argument shape as the detected resolver, executor, or workflow job                                                             |

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
    key: "tenant-api*",
    concurrencyPolicy: { maxConcurrentExecutions: 3 },
  }),
}));

export default defineConfig({
  workflow: { files: ["workflows/**/*.ts"] },
  workflowExecutionPolicies: executionPolicies,
});
```

### Plugins

Configure plugins using `definePlugins()`. Plugins must be exported as a named export.

```typescript
import { definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
import { enumConstantsPlugin } from "@tailor-platform/sdk/plugin/enum-constants";

export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: "./generated/tailordb.ts" }),
  enumConstantsPlugin({ distPath: "./generated/enums.ts" }),
);
```

See [Generators](./generator/index.md) for legacy `defineGenerators()` documentation.
