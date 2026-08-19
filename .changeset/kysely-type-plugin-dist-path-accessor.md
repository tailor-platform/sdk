---
"@tailor-platform/sdk": minor
---

Add `getKyselyTypePluginDistPath` to `@tailor-platform/sdk/plugin/kysely-type` for reading a project's configured Kysely types output path from its plugins array. Falls back to the conventional `./generated/tailordb.ts` path when `kyselyTypePlugin` has no `distPath` configured.
