---
"@tailor-platform/sdk": minor
---

Add TypeScript Language Service Plugin for automated type generation

- Add type-level inference utilities (InferTable, InferNamespace, EnumRecord) that map TailorDB type definitions to Kysely table types without code generation
- Add TS Language Service Plugin that auto-generates tailor-env.d.ts with declare module augmentation, eliminating manual tailor-sdk generate during development
- Add manifest CLI command for the TS Plugin to extract namespace-to-types mapping
