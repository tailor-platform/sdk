---
"@tailor-platform/sdk": minor
---

Define environment variables in `defineConfig()` and access them in resolvers and executors via the `env` parameter.

```typescript
export default defineConfig({
  name: "my-app",
  env: { logLevel: "debug", cacheTtl: 3600 },
});

// Access in resolver
body: ({ input, env }) => {
  // env.logLevel, env.cacheTtl available with full type safety
};
```
