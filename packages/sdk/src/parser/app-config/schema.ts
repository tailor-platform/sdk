import * as v from "valibot";
import { LOG_LEVELS } from "./log-level";

const envValueSchema = v.union([v.string(), v.number(), v.boolean()]);

// A boolean is never detected as a credential, so it cannot need an allowance.
const allowedSecretValueSchema = v.union([v.string(), v.number()]);

const envEntrySchema = v.union([
  envValueSchema,
  v.strictObject({
    value: allowedSecretValueSchema,
    allowSecretReason: v.pipe(
      v.string(),
      v.minLength(1, "'allowSecretReason' must state why the value is safe to keep in 'env'."),
    ),
  }),
]);

export const LogLevelSchema = v.picklist(LOG_LEVELS);

const logLevelSchema = v.pipe(
  v.string(),
  v.check(
    (value) => v.is(LogLevelSchema, value.trim().toUpperCase()),
    `'logLevel' must be one of: ${LOG_LEVELS.join(", ")}.`,
  ),
);

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
export const AppConfigSchema = v.strictObject({
  id: v.optional(v.pipe(v.string(), v.uuid("'id' must be a UUID."))),
  name: v.pipe(v.string(), v.minLength(1, "'name' must be a non-empty string.")),
  env: v.optional(v.record(v.string(), envEntrySchema)),
  cors: v.optional(v.array(v.string())),
  allowedIpAddresses: v.optional(v.array(v.string())),
  disableIntrospection: v.optional(v.boolean()),
  inlineSourcemap: v.optional(v.boolean()),
  logLevel: v.optional(logLevelSchema),
  db: v.optional(v.unknown()),
  resolver: v.optional(v.unknown()),
  idp: v.optional(v.unknown()),
  auth: v.optional(v.unknown()),
  executor: v.optional(v.unknown()),
  workflow: v.optional(v.unknown()),
  httpAdapter: v.optional(v.unknown()),
  staticWebsites: v.optional(v.unknown()),
  aiGateways: v.optional(v.unknown()),
  secrets: v.optional(v.unknown()),
});
