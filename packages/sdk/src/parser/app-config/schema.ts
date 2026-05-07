import { z } from "zod";

// Mirrors the platform metadata label value regex so that the generated app
// id is always a valid label value when stamped onto resources. Kept in sync
// with `cli/shared/config-id-injector.ts`.
const labelValueRegex = /^[a-z][a-z0-9_-]{0,62}$/;

const envValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/**
 * Structural validation schema for `defineConfig({...})`. Validates only
 * top-level fields with platform-side constraints (notably `id`); fields
 * that carry SDK builder objects (`auth`, `idp`, `db`, ...) are accepted
 * as opaque values, since their internal shapes are validated by their
 * own factory functions and parser-level schemas.
 */
export const AppConfigSchema = z.object({
  id: z
    .string()
    .regex(labelValueRegex, {
      message: `'id' must match ${labelValueRegex} (lowercase alnum, '-', '_'; start with a letter; max 63 chars).`,
    })
    .optional(),
  name: z.string().min(1, { message: "'name' must be a non-empty string." }),
  env: z.record(z.string(), envValueSchema).optional(),
  cors: z.array(z.string()).optional(),
  allowedIpAddresses: z.array(z.string()).optional(),
  disableIntrospection: z.boolean().optional(),
  inlineSourcemap: z.boolean().optional(),
  db: z.unknown().optional(),
  resolver: z.unknown().optional(),
  idp: z.unknown().optional(),
  auth: z.unknown().optional(),
  executor: z.unknown().optional(),
  workflow: z.unknown().optional(),
  staticWebsites: z.unknown().optional(),
  secrets: z.unknown().optional(),
});
