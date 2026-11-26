---
"@tailor-platform/sdk": minor
---

Replicate TailorDB tables into a BigQuery dataset you own. Define datasets with `defineTailorDBReplicationDestination()`, declare a namespace's replications in its `replications` config, and choose the tables and fields to copy with `.replication()` on each table; `tailor deploy` creates, updates, and deletes them. A destination is deployed with the replications that use it, and `dbReplicationDestinations` keeps one no replication uses yet. `deploy` prints the service account to grant access to the dataset, and checks the grant again on each deploy until it is in place.
