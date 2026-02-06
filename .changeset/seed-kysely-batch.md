---
"@tailor-platform/sdk": minor
---

feat(seed): use testExecScript API with Kysely batch insert for seeding

- Replace gql-ingest with Kysely batch insert for TailorDB seeding (100 rows/batch)
- Use direct fetch() for \_User seeding instead of gql-ingest
- Add topological sort for type insertion order
- Remove @jackchuka/gql-ingest dependency
- ~56% seeding performance improvement
