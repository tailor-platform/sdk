---
"@tailor-platform/sdk": minor
---

Add `tailor tailordb replication` commands: `list` lists the workspace's replications, `destination list` lists their destinations with each one's state and the service account to grant, `status <name>` shows the state of each table a replication writes, and `repair <name> [--type <type>...]` rewrites the tables in `ERROR`, or the tables of the named types after confirmation.
