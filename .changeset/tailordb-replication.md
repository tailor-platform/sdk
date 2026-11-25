---
"@tailor-platform/sdk": minor
---

Replicate TailorDB tables into a BigQuery dataset you own. Define datasets with `defineTailorDBReplicationDestination()` and replications with `defineTailorDBReplication()` and its `.add()`, list the replications in `dbReplications` of `defineConfig()` (a destination they use is deployed with them; `dbReplicationDestinations` keeps a destination no replication uses yet), and `tailor deploy` creates, updates, and deletes them. `deploy` prints the service account to grant access to the dataset, and checks the grant again on each deploy until it is in place.
