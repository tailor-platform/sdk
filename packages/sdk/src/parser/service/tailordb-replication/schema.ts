import { z } from "zod";
import { resourceNameSchema } from "#/parser/service/common";

const REPLICATION_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
const BIGQUERY_PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const BIGQUERY_DATASET_PATTERN = /^[a-zA-Z0-9_]+$/;
const TABLE_PREFIX_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
const TYPE_NAME_PATTERN = /^[A-Z][a-zA-Z0-9]{0,62}$/;
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

export const TailorDBReplicationTypeSchema = z
  .strictObject({
    name: z
      .string()
      .regex(TYPE_NAME_PATTERN, "must be a TailorDB type name")
      .describe("TailorDB type to replicate"),
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

export const TailorDBReplicationSchema = z.strictObject({
  name: replicationNameSchema.describe("Replication name"),
  source: z
    .strictObject({
      namespace: resourceNameSchema.describe(
        "TailorDB namespace to replicate from. Cannot be changed after the replication is created.",
      ),
    })
    .describe("Where the replicated types come from"),
  destination: replicationNameSchema.describe("Name of the replication destination to write into"),
  tablePrefix: z
    .string()
    .regex(
      TABLE_PREFIX_PATTERN,
      "must be 1-64 letters, digits, or underscores, not starting with a digit",
    )
    .optional()
    .describe("Prefix prepended to each destination table name"),
  enabled: z.boolean().default(true).describe("Whether the replication runs"),
  types: z
    .array(TailorDBReplicationTypeSchema)
    .max(1000, "must replicate at most 1000 types")
    .describe("Types to replicate"),
});
