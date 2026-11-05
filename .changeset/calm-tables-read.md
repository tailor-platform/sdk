---
"@tailor-platform/sdk": minor
---

Import `getDB` from `@tailor-platform/sdk/plugin/kysely-type/db` and omit `distPath` from `kyselyTypePlugin` to use Kysely types without running `tailor generate` or keeping a generated file. With TypeScript 7.1 or later and the SDK enabled as a content mapper for `.tailor` files in tsconfig.json, TypeScript derives the types from your TailorDB definitions and the plugin options. The plugin's `temporal` option applies to this `getDB` in deployed code, `tailor function run`, and tests run with `tailorRuntime({ config })`. `tailor function script` imports `getDB` from the SDK when the plugin has no `distPath`.
