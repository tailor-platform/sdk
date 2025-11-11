---
"@tailor-platform/tailor-sdk": patch
"@tailor-platform/create-tailor-sdk": patch
---

feat: add seed generator

Added `@tailor-platform/seed` generator that automatically generates seed data files from TailorDB type definitions. This generator creates:

- GraphQL Ingest mapping files (`mappings/*.json`) and GraphQL files for bulk data loading via [gql-ingest](https://github.com/jackchuka/gql-ingest)
- lines-db schema files (`data/*.schema.ts`) for validation via [lines-db](https://github.com/toiroakr/lines-db)
- Configuration file (`config.yaml`) defining entity dependencies

**Usage:**

```typescript
import { defineGenerators } from "@tailor-platform/tailor-sdk";

export const generators = defineGenerators([
  ["@tailor-platform/seed", { distPath: "./seed" }],
]);
```

This will generate seed data infrastructure based on your TailorDB types, enabling validation with [`lines-db`](https://github.com/toiroakr/lines-db) and data ingestion with [`gql-ingest`](https://github.com/jackchuka/gql-ingest).
