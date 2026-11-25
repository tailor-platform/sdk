---
"@tailor-platform/sdk": minor
---

Replicate TailorDB tables into a BigQuery dataset you own. Define datasets with `defineTailorDBReplicationDestination()` and replications with `defineTailorDBReplication()` and its `.add()`, list them in `dbReplicationDestinations` and `dbReplications` of `defineConfig()`, and `tailor deploy` creates, updates, and deletes them. `deploy` prints the service account to grant access to the dataset, and checks the grant again on each deploy until it is in place.
