---
"@tailor-platform/sdk": patch
---

Fix `Cannot find package '@/...'` from commands that load `tailor.config.ts` (for example `tailor generate`) when the project uses tsconfig `paths` aliases together with pnpm 11.23.0 or later and `enableGlobalVirtualStore: true`. pnpm's `NODE_PATH` resolve hook retries a failed import with a different `parentURL` and leaves it on the hook's context, so the TypeScript loader looked for `tsconfig.json` from `node_modules` instead of from the importing file. The loader now reads the importer before resolving and uses that value afterwards.
