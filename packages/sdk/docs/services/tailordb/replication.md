---
description: "Replicate TailorDB tables into a BigQuery dataset you own with defineTailorDBReplicationDestination() and defineTailorDBReplication()."
---

# TailorDB Replication

TailorDB replication copies the records of the tables you choose into a BigQuery dataset you own and keeps them up to date as records change. Analytics and reporting can then query BigQuery without loading TailorDB.

## Overview

- A **replication destination** is a BigQuery dataset that replications write into.
- A **replication** copies tables of one TailorDB namespace into one destination, one BigQuery table per TailorDB table.
- When a replication starts, or a table is added to it, the existing records are copied first; changes are then streamed as they happen.

## Destinations

Define a destination with `defineTailorDBReplicationDestination()` and list it in `dbReplicationDestinations`:

```typescript
import { defineConfig, defineTailorDBReplicationDestination } from "@tailor-platform/sdk";

const warehouse = defineTailorDBReplicationDestination("warehouse", {
  bigquery: { project: "acme-analytics", dataset: "tailor" },
});

export default defineConfig({
  name: "shop",
  dbReplicationDestinations: [warehouse],
});
```

- Destination names are unique across the workspace, and each destination writes to a different dataset.
- A destination's project and dataset cannot be changed. To write to another dataset, define a destination with a new name and point the replications at it.

### Granting access

Replications write to BigQuery as the workspace's replication service account, which every destination of the workspace shares. When `tailor deploy` creates a destination, it prints that account's email. Grant it:

- the **BigQuery Data Editor** role (`roles/bigquery.dataEditor`) on the dataset
- the **BigQuery Job User** role (`roles/bigquery.jobUser`) on the project

Until the grant is in place, the destination cannot be written to, and `deploy` prints the email and the missing grant again. Each `deploy` checks the grant of a destination still waiting for it, so you do not need to do anything else after granting.

If your Google Cloud organization restricts IAM policy members to its own domains (the `iam.allowedPolicyMemberDomains` organization policy), the service account cannot be granted a role until the policy also allows Tailor's Google Workspace customer ID. Contact Tailor support for the ID to add.

## Replications

Define a replication with `defineTailorDBReplication()`, add each table with `.add()`, and list it in `dbReplications`:

```typescript
import {
  defineConfig,
  defineTailorDBReplication,
  defineTailorDBReplicationDestination,
} from "@tailor-platform/sdk";
import { order } from "./tailordb/order";
import { user } from "./tailordb/user";

const warehouse = defineTailorDBReplicationDestination("warehouse", {
  bigquery: { project: "acme-analytics", dataset: "tailor" },
});

const analytics = defineTailorDBReplication("analytics", {
  source: { namespace: "main-db" },
  destination: "warehouse",
  tablePrefix: "shop_",
})
  .add(user, { excludeFields: ["email", "phone"] })
  .add(order);

export default defineConfig({
  name: "shop",
  db: { "main-db": { files: ["./tailordb/*.ts"] } },
  dbReplicationDestinations: [warehouse],
  dbReplications: [analytics],
});
```

- `source.namespace` must be a namespace this config defines in `db`; an external namespace is replicated from the config that defines it.
- `destination` must be a destination listed in `dbReplicationDestinations` of the same config.
- Each table passed to `.add()` must be loaded by the namespace's `files`, and can be added once.
- `.add()` returns a new replication and leaves the one it was called on unchanged.
- `enabled` defaults to `true`. Set `enabled: false` to pause a replication; while it is paused, its BigQuery tables stop changing, and enabling it again rewrites them.

### Choosing fields

By default every field of a table is replicated. Pass at most one of:

- `excludeFields`: replicate every field but these. Fields added to the table later are replicated.
- `includeFields`: replicate only these fields. Fields added to the table later are not replicated.

Field names are checked against the table's fields. The `id` field is always replicated.

### Table names

Each table is written to the BigQuery table `<tablePrefix><TableName>`, for example `shop_User`. BigQuery table names are compared without regard to case, so two replications cannot write the same table name in one destination, and one replication cannot replicate two tables whose names differ only in case.

### What is not replicated

- [File fields](./index.md#file-fields): neither file contents nor their metadata.
- Vector fields. They cannot be listed in `includeFields`.

## Deploying changes

`tailor deploy` creates, updates, and deletes destinations and replications along with the TailorDB tables they read, in an order the platform accepts: a table is removed from the replications that list it before it is deleted, and a replication moves off a destination before the destination is deleted.

- Removing a table from a replication stops writing its BigQuery table; the data already there is kept. Adding a table copies its existing records first.
- Changing a replication's `source.namespace` deletes the replication and creates it again, which rewrites all its tables. `deploy` asks for confirmation before it does this, and before it deletes a replication.
- Deleting a replication or a destination leaves the data already in BigQuery as it is.
- If one deploy would have two replications exchange their tables, for example by swapping their `tablePrefix`, `deploy` stops before changing anything and asks you to make the change in two deploys.
- If the platform disables a replication, for example while its workspace is deleted, the next `deploy` enables it again and its tables are rewritten.
