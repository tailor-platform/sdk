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

### Application Settings

```typescript
export default defineConfig({
  name: "my-app",
  cors: ["https://example.com", website.url],
  allowedIPAddresses: ["192.168.1.0/24"],
  disableIntrospection: false,
});
```

**Name**: Set the application name.

**CORS**: Specify CORS settings as an array.

**Allowed IP Addresses**: Specify IP addresses allowed to access the application in CIDR format.

**Disable Introspection**: Disable GraphQL introspection. Default is `false`.

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

### Built-in IdP

Configure the Built-in IdP service using `defineIdp()`. See [IdP](./services/idp.md) for full documentation.

```typescript
import { defineIdp } from "@tailor-platform/sdk";

const idp = defineIdp("my-idp", {
  authorization: "loggedIn",
  clients: ["my-client"],
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

### Environment Variables

Define environment variables that can be accessed in resolvers, executors, and workflows:

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

### Generators

Configure code generators using `defineGenerators()`. Generators must be exported as a named export.

```typescript
import { defineGenerators } from "@tailor-platform/sdk";

export const generators = defineGenerators(
  ["@tailor-platform/kysely-type", { distPath: "./generated/tailordb.ts" }],
  ["@tailor-platform/enum-constants", { distPath: "./generated/enums.ts" }],
);
```

See [Generators](./generator/index.md) for full documentation.
