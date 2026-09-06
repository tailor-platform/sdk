import { z } from "zod";
import { LOG_LEVELS } from "./log-level";

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

const metadataValueSchema = z.string().regex(METADATA_VALUE_PATTERN, {
  message: `'metadata' values must match ${METADATA_VALUE_PATTERN.source}.`,
});

// A key schema on `z.record` reports a generic "Invalid key in record", so the
// keys are checked here to name the offending key and the constraint.
const metadataSchema = z.record(z.string(), metadataValueSchema).superRefine((metadata, ctx) => {
  for (const key of Object.keys(metadata)) {
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

/**
 * Structural validation schema for `defineConfig({...})`. Validates only
 * top-level fields with platform-side constraints (notably `id`); fields
 * that carry SDK builder objects (`auth`, `idp`, `db`, ...) are accepted
 * as opaque values, since their internal shapes are validated by their
 * own factory functions and parser-level schemas.
 *
 * The `id` is auto-managed by `deploy` and stored as a plain UUID. A
 * label-compatible prefix is added at the metadata boundary, so user-facing
 * configs only need to carry a UUID.
 */
export const AppConfigSchema = z.strictObject({
  id: z.uuid({ message: "'id' must be a UUID." }).optional(),
  name: z.string().min(1, { message: "'name' must be a non-empty string." }),
  env: z.record(z.string(), envEntrySchema).optional(),
  cors: z.array(z.string()).optional(),
  allowedIpAddresses: z.array(z.string()).optional(),
  disableIntrospection: z.boolean().optional(),
  inlineSourcemap: z.boolean().optional(),
  logLevel: logLevelSchema.optional(),
  metadata: metadataSchema.optional(),
  db: z.unknown().optional(),
  resolver: z.unknown().optional(),
  idp: z.unknown().optional(),
  auth: z.unknown().optional(),
  executor: z.unknown().optional(),
  workflow: z.unknown().optional(),
  httpAdapter: z.unknown().optional(),
  staticWebsites: z.unknown().optional(),
  aiGateways: z.unknown().optional(),
  secrets: z.unknown().optional(),
});
