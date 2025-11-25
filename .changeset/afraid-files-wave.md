---
"@tailor-platform/sdk": patch
---

Reference external resources

You can now add resources managed by Terraform or other SDK projects to your application's subgraph for shared use.
In this case, the resources themselves are not deployed.

```typescript
defineConfig({
  name: "ref-app",
  db: {
    "shared-db": { external: true },
  },
  resolver: { "shared-resolver": { external: true } },
  auth: { name: "shared-auth", external: true },
  idp: [{ name: "shared-idp", external: true }],
});
```
