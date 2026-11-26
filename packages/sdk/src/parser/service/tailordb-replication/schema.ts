import { z } from "zod";

const REPLICATION_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
const BIGQUERY_PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const BIGQUERY_DATASET_PATTERN = /^[a-zA-Z0-9_]+$/;
const TABLE_PREFIX_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
const FIELD_NAME_PATTERN = /^[a-z][0-9a-zA-Z]{0,62}$/;

const replicationNameSchema = z
  .string()
  .regex(
    REPLICATION_NAME_PATTERN,
    "must be 2-63 lowercase letters, digits, or hyphens, starting and ending with a letter or digit",
  );

const fieldListSchema = z
  .array(z.string().regex(FIELD_NAME_PATTERN, "must be a TailorDB field name"))
  .min(1, "must list at least one field")
  .max(1000, "must list at most 1000 fields")
  .refine((names) => new Set(names).size === names.length, "must not list a field twice");

export const TailorDBReplicationDestinationSchema = z.strictObject({
  name: replicationNameSchema.describe("Replication destination name"),
  bigquery: z
    .strictObject({
      project: z
        .string()
        .regex(BIGQUERY_PROJECT_PATTERN, "must be a Google Cloud project ID")
        .describe(
          "Google Cloud project ID hosting the dataset. Cannot be changed after the destination is created.",
        ),
      dataset: z
        .string()
        .regex(BIGQUERY_DATASET_PATTERN, "must be letters, digits, or underscores")
        .max(1024, "must be at most 1024 characters")
        .describe("BigQuery dataset ID. Cannot be changed after the destination is created."),
    })
    .describe("BigQuery dataset to replicate into"),
});

export const TailorDBReplicationSettingsSchema = z.strictObject({
  destination: TailorDBReplicationDestinationSchema.describe(
    "Destination to write into, as returned by `defineTailorDBReplicationDestination()`",
  ),
  tablePrefix: z
    .string()
    .regex(
      TABLE_PREFIX_PATTERN,
      "must be 1-64 letters, digits, or underscores, not starting with a digit",
    )
    .optional()
    .describe("Prefix prepended to each destination table name"),
  enabled: z.boolean().default(true).describe("Whether the replication runs"),
});

export const TailorDBReplicationsSchema = z
  .record(replicationNameSchema, TailorDBReplicationSettingsSchema.optional())
  .describe(
    "Replications of this namespace's tables, keyed by replication name. A replication whose value is `undefined` is declared but not deployed.",
  );

export const TailorDBTypeReplicationSchema = z
  .strictObject({
    targets: z
      .array(replicationNameSchema)
      .min(1, "must name at least one replication")
      .refine((names) => new Set(names).size === names.length, "must not name a replication twice")
      .optional()
      .describe("Replications of the namespace that copy this table; every one when omitted"),
    excludeFields: fieldListSchema
      .optional()
      .describe("Replicate every field but these. Fields added later are replicated."),
    includeFields: fieldListSchema
      .optional()
      .describe("Replicate only these fields. Fields added later are not replicated."),
  })
  .refine((type) => type.excludeFields === undefined || type.includeFields === undefined, {
    message: "Specify either `excludeFields` or `includeFields`, not both.",
  });

export const TailorDBPluginTableSchema = z.strictObject({
  replication: z
    .union([
      z.literal(false),
      z
        .array(TailorDBTypeReplicationSchema)
        .min(1, "must list at least one entry, or be false to leave the table out"),
    ])
    .optional()
    .describe(
      "How replications of the namespace copy the table, in place of the plugin's `.replication()`; `false` leaves the table out",
    ),
});

export const TailorDBPluginTablesSchema = z
  .record(z.string(), TailorDBPluginTableSchema)
  .describe("Settings of tables that plugins generate in this namespace, keyed by table name");
