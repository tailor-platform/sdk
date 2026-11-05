---
"@tailor-platform/sdk": minor
---

Call resolvers and TailorDB records from the frontend as typed functions. With TypeScript 7.1 or later, import `resolvers.tailor` and `tailordb.tailor` and add the SDK as a content mapper for `.tailor` files: arguments and results are typed from your `createResolver` and table definitions, and the new `tailorResolvers` Vite plugin and `@tailor-platform/sdk/client` send the GraphQL requests. Tables offer `get`, `list`, `create`, `update`, and `delete`, with `select`, `include` for relations, and filter operators typed by field kind. The content mapper now takes a `config` option, a path to `tailor.config.ts`, and picks the config nearest to a `.tailor` file.
