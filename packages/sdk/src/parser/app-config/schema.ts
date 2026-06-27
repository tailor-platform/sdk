import { z } from "zod";
import { LOG_LEVELS } from "./log-level";

const envValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const LogLevelSchema = z.enum(LOG_LEVELS);

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
// strip unknown keys
export const AppConfigSchema = z.object({
  id: z.uuid({ message: "'id' must be a UUID." }).optional(),
  name: z.string().min(1, { message: "'name' must be a non-empty string." }),
  env: z.record(z.string(), envValueSchema).optional(),
  cors: z.array(z.string()).optional(),
  allowedIpAddresses: z.array(z.string()).optional(),
  disableIntrospection: z.boolean().optional(),
  inlineSourcemap: z.boolean().optional(),
  logLevel: logLevelSchema.optional(),
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
