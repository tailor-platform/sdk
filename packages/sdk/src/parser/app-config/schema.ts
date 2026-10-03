import { z } from "zod";
import { TailorDBServiceConfigSchema } from "#/parser/service/tailordb/schema";
import { isForbiddenGlobal } from "#/utils/node-builtins";
import { LOG_LEVELS } from "./log-level";
import type { TailorDBServiceConfigInput } from "#/types/tailordb.generated";

const envValueSchema = z.union([z.string(), z.number(), z.boolean()]);

// A boolean is never detected as a credential, so it cannot need an allowance.
const allowedSecretValueSchema = z.union([z.string(), z.number()]);

const envEntrySchema = z.union([
  envValueSchema,
  z.strictObject({
    value: allowedSecretValueSchema,
    allowSecretReason: z.string().min(1, {
      message: "'allowSecretReason' must state why the value is safe to keep in 'env'.",
    }),
  }),
]);

export const LogLevelSchema = z.enum(LOG_LEVELS);

const METADATA_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/;
const METADATA_VALUE_PATTERN = /^$|^[a-z][a-z0-9_-]{0,62}$/;
const RESERVED_METADATA_KEY_PREFIX = "sdk-";
// The platform stores at most 20 labels per resource; deploy writes three of its own.
const MAX_METADATA_ENTRIES = 17;

const metadataValueSchema = z.string().regex(METADATA_VALUE_PATTERN, {
  message: `'metadata' values must match ${METADATA_VALUE_PATTERN.source}.`,
});

// A key schema on `z.record` reports a generic "Invalid key in record", so the
// keys are checked here to name the offending key and the constraint.
const metadataSchema = z.record(z.string(), metadataValueSchema).superRefine((metadata, ctx) => {
  const keys = Object.keys(metadata);
  if (keys.length > MAX_METADATA_ENTRIES) {
    ctx.addIssue({
      code: "custom",
      message: `'metadata' can hold at most ${MAX_METADATA_ENTRIES} entries.`,
    });
  }
  for (const key of keys) {
    if (!METADATA_KEY_PATTERN.test(key)) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `'metadata' keys must match ${METADATA_KEY_PATTERN.source}.`,
      });
    } else if (key.startsWith(RESERVED_METADATA_KEY_PREFIX)) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `'metadata' keys starting with '${RESERVED_METADATA_KEY_PREFIX}' are reserved for the SDK.`,
      });
    }
  }
});

const logLevelSchema = z
  .string()
  .refine((value) => LogLevelSchema.safeParse(value.trim().toUpperCase()).success, {
    message: `'logLevel' must be one of: ${LOG_LEVELS.join(", ")}.`,
  });

const allowedRuntimeGlobalNameSchema = z.string().refine(isForbiddenGlobal, {
  error: (issue) =>
    `'allowedRuntimeGlobals' lists '${String(issue.input)}', which is not a Node-only global the Tailor Platform runtime lacks.`,
});

const allowedRuntimeGlobalsSchema = z.record(
  z.string().min(1),
  z.union([z.literal(true), z.array(allowedRuntimeGlobalNameSchema)]),
);

const buildOptionsSchema = z.strictObject({
  inlineSourcemap: z.boolean().optional(),
  logLevel: logLevelSchema.optional(),
  allowedRuntimeGlobals: allowedRuntimeGlobalsSchema.optional(),
});

const MOVED_TO_BUILD_OPTIONS = ["inlineSourcemap", "logLevel"] as const;

export const TailorDBReferenceConfigSchema = z.union([
  z.strictObject({ attach: z.literal(true), schemaFrom: z.string().min(1).optional() }),
  z.strictObject({ attach: z.literal(false), schemaFrom: z.string().min(1) }),
]);

const attachedServiceSchema = z.strictObject({ attach: z.literal(true) });
const externalServiceSchema = z.strictObject({ external: z.literal(true) });
const legacyServiceReferenceSchema = externalServiceSchema.transform(() => ({
  attach: true as const,
}));
const serviceReferenceSchema = z.union([attachedServiceSchema, legacyServiceReferenceSchema]);
const namedServiceReferenceSchema = z.union([
  attachedServiceSchema.extend({ name: z.string().min(1) }),
  externalServiceSchema
    .extend({ name: z.string().min(1) })
    .transform(({ name }) => ({ name, attach: true as const })),
]);

const dbEntrySchema = z.union([
  z.custom<TailorDBServiceConfigInput>().superRefine((value, ctx) => {
    const result = TailorDBServiceConfigSchema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue({ ...issue });
    }
  }),
  TailorDBReferenceConfigSchema,
  legacyServiceReferenceSchema,
]);

function serviceEntrySchema(named: boolean) {
  return z.unknown().transform((value, ctx) => {
    if (!value || typeof value !== "object" || !("attach" in value || "external" in value)) {
      return value;
    }
    const schema = named ? namedServiceReferenceSchema : serviceReferenceSchema;
    const result = schema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue({ ...issue });
      return z.NEVER;
    }
    return result.data;
  });
}

/**
 * Structural validation schema for `defineConfig({...})`. Validates only
 * top-level fields with platform-side constraints (notably `id`); fields
 * that carry SDK builder objects (`auth`, `idp`, ...) are accepted
 * as opaque values, since their internal shapes are validated by their
 * own factory functions and parser-level schemas.
 *
 * The `id` is auto-managed by `deploy` and stored as a plain UUID. A
 * label-compatible prefix is added at the metadata boundary, so user-facing
 * configs only need to carry a UUID.
 */
export const AppConfigSchema = z
  .strictObject({
    id: z.uuid({ message: "'id' must be a UUID." }).optional(),
    name: z.string().min(1, { message: "'name' must be a non-empty string." }),
    env: z.record(z.string(), envEntrySchema).optional(),
    cors: z.array(z.string()).optional(),
    allowedIpAddresses: z.array(z.string()).optional(),
    disableIntrospection: z.boolean().optional(),
    inlineSourcemap: z.boolean().optional(),
    logLevel: logLevelSchema.optional(),
    buildOptions: buildOptionsSchema.optional(),
    metadata: metadataSchema.optional(),
    db: z.record(z.string(), dbEntrySchema).optional(),
    resolver: z.record(z.string(), serviceEntrySchema(false)).optional(),
    idp: z.array(serviceEntrySchema(true)).optional(),
    auth: serviceEntrySchema(true).optional(),
    executor: z.unknown().optional(),
    workflow: z.unknown().optional(),
    httpAdapter: z.unknown().optional(),
    staticWebsites: z.unknown().optional(),
    aiGateways: z.unknown().optional(),
    secrets: z.unknown().optional(),
  })
  .superRefine((config, ctx) => {
    for (const field of MOVED_TO_BUILD_OPTIONS) {
      if (config[field] !== undefined && config.buildOptions?.[field] !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `'${field}' is set both at the top level and in 'buildOptions.${field}'. Keep only 'buildOptions.${field}'.`,
        });
      }
    }
  });

export const NormalizedDbEntrySchema = z.union([
  z.strictObject({
    owned: z.literal(true),
    inSubgraph: z.literal(true),
    schemaSource: z.strictObject({
      kind: z.literal("files"),
      config: z.custom<TailorDBServiceConfigInput>(),
    }),
  }),
  z.strictObject({
    owned: z.literal(false),
    inSubgraph: z.boolean(),
    schemaSource: z.strictObject({ kind: z.literal("config"), path: z.string() }).optional(),
  }),
]);

export const NormalizedDbSchema = z.record(z.string(), NormalizedDbEntrySchema);
