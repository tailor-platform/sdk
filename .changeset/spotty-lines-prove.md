---
"@tailor-platform/sdk": minor
---

Import .sql files into resolvers, executors, workflow jobs, and auth hooks. With TypeScript 7.1 or later, add the SDK as a content mapper for .sql files in tsconfig.json to type each query's parameters and rows from your TailorDB tables and check it against TailorDB's SQL; run it with `query.run(client, params)` on a `tailordb.Client`.
