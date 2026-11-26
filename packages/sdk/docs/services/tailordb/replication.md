---
description: "Replicate TailorDB tables into a BigQuery dataset you own with a namespace's replications config, .replication() on tables, pluginTables for tables that plugins generate, and defineTailorDBReplicationDestination()."
---

# TailorDB Replication

TailorDB replication copies the records of the tables you choose into a BigQuery dataset you own and keeps them up to date as records change. Analytics and reporting can then query BigQuery without loading TailorDB.

## Overview

- A **replication destination** is a BigQuery dataset that replications write into.
- A **replication** copies tables of one TailorDB namespace into one destination, one BigQuery table per TailorDB table.
- When a replication starts, or a table is added to it, the existing records are copied first; changes are then streamed as they happen.

## Destinations

Define a destination with `defineTailorDBReplicationDestination()`. A replication that writes into it deploys it, so a destination needs no other entry in the config. To deploy a destination that no replication uses yet, for example to grant access before adding replications, list it in `dbReplicationDestinations`:

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

- Destination names are unique across the workspace, and each destination writes to a different dataset. Project and dataset names are compared case-insensitively.
- A destination's project and dataset cannot be changed. To write to another dataset, define a destination with a new name and point the replications at it.
- A destination that no replication uses can be renamed while keeping its dataset. To move replications to a renamed destination on the same dataset, first deploy without the old destination and the replications that use it, then add the new destination and the replications in a later deploy.
- A destination that is neither used by a replication nor listed in `dbReplicationDestinations` is deleted.

### Granting access

Replications write to BigQuery as the workspace's replication service account, which every destination of the workspace shares. When `tailor deploy` creates a destination, it prints that account's email; [`tailor tailordb replication destination list`](../../cli/tailordb.md#tailordb-replication-destination-list) shows it later too. Grant it:

- the **BigQuery Data Editor** role (`roles/bigquery.dataEditor`) on the dataset
- the **BigQuery Job User** role (`roles/bigquery.jobUser`) on the project

Until the grant is in place, the destination cannot be written to, and `deploy` prints the email and the missing grant again. Each `deploy` checks the grant of a destination still waiting for it, so you do not need to do anything else after granting.

If your Google Cloud organization restricts IAM policy members to its own domains (the `iam.allowedPolicyMemberDomains` organization policy), the service account cannot be granted a role until the policy also allows Tailor's Google Workspace customer ID. Contact Tailor support for the ID to add.

## Replications

Declare a namespace's replications in its `replications` config, keyed by replication name, and choose the tables to copy with `.replication()` on each table you define:

```typescript
// tailor.config.ts
import { defineConfig, defineTailorDBReplicationDestination } from "@tailor-platform/sdk";

const warehouse = defineTailorDBReplicationDestination("warehouse", {
  bigquery: { project: "acme-analytics", dataset: "tailor" },
});

export default defineConfig({
  name: "shop",
  db: {
    "main-db": {
      files: ["./tailordb/*.ts"],
      replications: {
        analytics: { destination: warehouse, tablePrefix: "shop_" },
      },
    },
  },
});
```

```typescript
// tailordb/user.ts
export const user = db
  .table("User", { name: db.string(), email: db.string(), phone: db.string() })
  .replication({ excludeFields: ["email", "phone"] });

// tailordb/order.ts
export const order = db.table("Order", { total: db.int() }).replication({});
```

- A replication copies tables of the namespace that declares it. Replication names are unique across the workspace.
- `destination` is the value `defineTailorDBReplicationDestination()` returned. Two different destinations cannot share a name.
- A table without `.replication()` is not replicated, except a table a plugin generates that `pluginTables` sets (see [Tables that plugins generate](#tables-that-plugins-generate)). An entry without `targets` applies to every replication of the namespace.
- To copy a table differently per replication, pass one entry per replication and name it in `targets`:

  ```typescript
  export const order = db
    .table("Order", { total: db.int(), note: db.string() })
    .replication({ targets: ["analytics"], excludeFields: ["note"] }, { targets: ["lake"] });
  ```

  A target the namespace does not declare in `replications`, or a replication set by two entries of one table, fails when the config loads.

- `enabled` defaults to `true`. Set `enabled: false` to pause a replication; while it is paused, its BigQuery tables stop changing, and enabling it again rewrites them.

### Deploying to some environments only

Set a replication to `undefined` to declare it without deploying it. Tables can still name it in `targets`, so table files stay the same in every environment, and a workspace without the replication needs no BigQuery dataset:

```typescript
const appEnv = process.env.APP_ENV;
if (!appEnv) throw new Error("Set APP_ENV to the environment to deploy to.");

export default defineConfig({
  name: "shop",
  db: {
    "main-db": {
      files: ["./tailordb/*.ts"],
      replications: {
        analytics: appEnv === "production" ? { destination: warehouse } : undefined,
      },
    },
  },
});
```

When a deployed replication becomes `undefined`, `deploy` deletes it, and deploying it again copies every table in full. Fail when the value that selects the environment is missing, as above, so that a deploy run without it does not delete the replication; `deploy --yes` skips the confirmation that would otherwise catch it. See [Multi-Environment Configuration](../../multi-environment.md) for loading per-environment values.

### Choosing fields

By default every field of a table is replicated. Pass at most one of:

- `excludeFields`: replicate every field but these. Fields added to the table later are replicated.
- `includeFields`: replicate only these fields. Fields added to the table later are not replicated.

Field names are checked against the table's fields, per `.replication()` entry. The `id` field is always replicated.

### Tables that plugins generate

A plugin can generate tables that you do not define yourself, such as an audit log table. A plugin replicates such a table by calling `.replication()` on it; the plugin's documentation says which tables it replicates and which fields it leaves out.

To choose for yourself, set the table's `replication` in the namespace's `pluginTables`, keyed by the table's name. It takes the same entries as `.replication()` and replaces what the plugin sets; `false` leaves the table out:

```typescript
export default defineConfig({
  name: "shop",
  db: {
    "main-db": {
      files: ["./tailordb/*.ts"],
      replications: {
        analytics: { destination: warehouse, tablePrefix: "shop_" },
        lake: { destination: warehouse, tablePrefix: "lake_" },
      },
      pluginTables: {
        AuditLog: { replication: [{ targets: ["analytics"], excludeFields: ["ipAddress"] }] },
        DeletedOrder: { replication: false },
      },
    },
  },
});
```

- A key that names no table a plugin generates in the namespace fails when the config loads, and the error lists the tables plugins generate there. Set tables you define with `.replication()` instead.
- Your entries replace the plugin's as a whole. A field the plugin leaves out is replicated unless your entry leaves it out too, and changes a later version of the plugin makes to its `.replication()` no longer apply to the table.
- If the plugin runs only in some environments, set its tables in `pluginTables` only where it runs.

### Table names

Each table is written to the BigQuery table `<tablePrefix><TableName>`, for example `shop_User`. BigQuery table names are compared without regard to case, so two replications cannot write the same table name in one destination, and one replication cannot replicate two tables whose names differ only in case.

### What is not replicated

- [File fields](./index.md#file-fields): neither file contents nor their metadata.
- Vector fields. They cannot be listed in `includeFields`.

## Deploying changes

`tailor deploy` creates, updates, and deletes destinations and replications along with the TailorDB tables they read, in an order the platform accepts: a table is removed from the replications that list it before it is deleted, and a replication moves off a destination before the destination is deleted.

- Removing a table from a replication stops writing its BigQuery table; the data already there is kept. Adding a table copies its existing records first.
- Moving a replication to another namespace deletes the replication and creates it again, which rewrites all its tables. `deploy` asks for confirmation before it does this, and before it deletes a replication.
- Deleting a replication or a destination leaves the data already in BigQuery as it is.
- If one deploy would have two replications exchange their tables, for example by swapping their `tablePrefix`, `deploy` deletes one of them and creates it again, which rewrites all its tables. `deploy` asks for confirmation first.
- If the platform disables a replication, for example while its workspace is deleted, the next `deploy` enables it again and its tables are rewritten.

## Checking and repairing tables

[`tailor tailordb replication list`](../../cli/tailordb.md#tailordb-replication-list) lists the workspace's replications. [`tailor tailordb replication status <name>`](../../cli/tailordb.md#tailordb-replication-status) shows the state of each table a replication writes. A table in `ERROR`, for example one deleted in BigQuery, stays there until it is repaired: [`tailor tailordb replication repair <name>`](../../cli/tailordb.md#tailordb-replication-repair) rewrites the tables in `ERROR`, and `--type` rewrites the tables of the types you name.
