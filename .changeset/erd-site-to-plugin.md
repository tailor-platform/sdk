---
"@tailor-platform/sdk": major
"@tailor-platform/sdk-plugin-tailordb-erd": minor
"@tailor-platform/sdk-codemod": patch
---

Move the TailorDB `erdSite` setting out of the core config schema into the ERD plugin's own configuration. `db.<namespace>.erdSite` is no longer accepted in `tailor.config.ts`; configure the ERD deploy target on the plugin instead:

```ts
import { tailordbErdPlugin } from "@tailor-platform/sdk-plugin-tailordb-erd/plugin";

export const plugins = definePlugins(
  // TailorDB namespace name → static website name
  tailordbErdPlugin({ sites: { tailordb: "my-erd-site" } }),
);
```

The `tailor tailordb erd` commands resolve deploy targets from `tailordbErdPlugin({ sites })` and now validate each namespace against `config.db` and each site name against `staticWebsites`, so typos surface when the config is loaded instead of at deploy time. The `v2/erd-site-to-plugin` codemod migrates existing configs automatically. For programmatic users, `loadTailorDBNamespaces()` additionally returns the config module's registered `plugins`, and namespace selector callbacks receive them as a second argument.
