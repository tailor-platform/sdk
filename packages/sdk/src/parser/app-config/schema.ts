import { z } from "zod";
import { isForbiddenGlobal } from "#/utils/node-builtins";
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

const treeshakeSchema = z.strictObject({
  moduleSideEffects: z.boolean().optional(),
  annotations: z.boolean().optional(),
  unknownGlobalSideEffects: z.boolean().optional(),
  propertyReadSideEffects: z.boolean().optional(),
});

const buildOptionsSchema = z.strictObject({
  inlineSourcemap: z.boolean().optional(),
  inlineSourcemapDependencySources: z.union([z.boolean(), z.array(z.string())]).optional(),
  inlineSourcemapProjectSources: z
    .strictObject({
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
    })
    .optional(),
  logLevel: logLevelSchema.optional(),
  allowedRuntimeGlobals: allowedRuntimeGlobalsSchema.optional(),
  treeshake: treeshakeSchema.optional(),
});

const MOVED_TO_BUILD_OPTIONS = ["inlineSourcemap", "logLevel"] as const;

const envSchema = z.record(z.string(), envEntrySchema);

const defaultDateRepresentationSchema = z.enum(["temporal", "date"], {
  message: `'defaultDateRepresentation' must be "temporal" or "date".`,
});

const maintenanceModeSchema = z.union([z.literal(false), z.enum(["migration", "deploy"])], {
  message: `'maintenanceMode' must be false, "migration", or "deploy".`,
});

const applicationSettingsShape = {
  cors: z.array(z.string()).optional(),
  allowedIpAddresses: z.array(z.string()).optional(),
  disableIntrospection: z.boolean().optional(),
  metadata: metadataSchema.optional(),
};

const workspaceSettingsShape = {
  env: envSchema.optional(),
  buildOptions: buildOptionsSchema.optional(),
  defaultDateRepresentation: defaultDateRepresentationSchema.optional(),
  maintenanceMode: maintenanceModeSchema.optional(),
  executor: z.unknown().optional(),
  workflow: z.unknown().optional(),
  httpAdapter: z.unknown().optional(),
  staticWebsites: z.unknown().optional(),
  aiGateways: z.unknown().optional(),
  secrets: z.unknown().optional(),
};

const singleApplicationShape = {
  name: z.string().min(1, { message: "'name' must be a non-empty string." }),
  ...applicationSettingsShape,
  ...workspaceSettingsShape,
  db: z.unknown().optional(),
  resolver: z.unknown().optional(),
  idp: z.unknown().optional(),
  auth: z.unknown().optional(),
};

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
export const AppConfigSchema = z
  .strictObject({
    id: z.uuid({ message: "'id' must be a UUID." }).optional(),
    ...singleApplicationShape,
    inlineSourcemap: z.boolean().optional(),
    logLevel: logLevelSchema.optional(),
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

const EXTERNAL_MESSAGE =
  "'external' is only accepted by defineConfig(). Declare the service in this config instead.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function entriesOf(value: unknown): [string, unknown][] {
  return isRecord(value) ? Object.entries(value) : [];
}

function rejectExternal(entry: unknown, path: PropertyKey[], ctx: z.RefinementCtx): void {
  if (isRecord(entry) && entry.external === true) {
    ctx.addIssue({ code: "custom", path: [...path, "external"], message: EXTERNAL_MESSAGE });
  }
}

function rejectEnvOverride(entry: unknown, path: string[], ctx: z.RefinementCtx): void {
  if (isRecord(entry) && entry.env !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: [...path, "env"],
      message: `'${path.join(".")}.env' is only accepted by defineWorkspace().`,
    });
  }
}

/**
 * Structural validation schema for `defineApp({...})`: the fields of
 * `defineConfig` without `id` and the deprecated top-level build options,
 * with services marked `external` rejected.
 */
export const AppDefinitionSchema = z
  .strictObject(singleApplicationShape)
  .superRefine((config, ctx) => {
    for (const [namespace, entry] of entriesOf(config.db)) {
      rejectExternal(entry, ["db", namespace], ctx);
    }
    for (const [namespace, entry] of entriesOf(config.resolver)) {
      rejectExternal(entry, ["resolver", namespace], ctx);
      rejectEnvOverride(entry, ["resolver", namespace], ctx);
    }
    rejectEnvOverride(config.executor, ["executor"], ctx);
    rejectEnvOverride(config.workflow, ["workflow"], ctx);
    rejectExternal(config.auth, ["auth"], ctx);
    checkEnvOverride(config.auth, ["auth"], config.env ?? {}, ctx);
    rejectExternal(config.idp, ["idp"], ctx);
  });

const workspaceApplicationSchema = z.strictObject({
  ...applicationSettingsShape,
  db: z.array(z.string()).optional(),
  resolver: z.array(z.string()).optional(),
  auth: z.string().optional(),
  idp: z
    .array(z.string())
    .max(1, {
      message:
        "An application can expose at most one IdP. Call idp.Client({ namespace }) from function code to use the others.",
    })
    .optional(),
});

const serviceRecordSchema = z.record(z.string(), z.unknown());

function checkEnvOverride(
  entry: unknown,
  path: string[],
  rootEnv: Record<string, unknown>,
  ctx: z.RefinementCtx,
): void {
  if (!isRecord(entry) || entry.env === undefined) return;
  const parsed = envSchema.safeParse(entry.env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ ...issue, path: [...path, "env", ...issue.path] });
    }
    return;
  }
  for (const key of Object.keys(parsed.data)) {
    if (!Object.hasOwn(rootEnv, key)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, "env", key],
        message: `'${path.join(".")}.env' overrides "${key}", which the root 'env' does not declare.`,
      });
    }
  }
}

function checkKeyedByName(
  record: unknown,
  service: "auth" | "idp",
  label: string,
  ctx: z.RefinementCtx,
): void {
  for (const [key, entry] of entriesOf(record)) {
    if (isRecord(entry) && entry.name !== key) {
      ctx.addIssue({
        code: "custom",
        path: [service, key, "name"],
        message: `'${service}.${key}' holds the ${label} named "${String(entry.name)}". Key it by its name.`,
      });
    }
  }
}

/**
 * Structural validation schema for `defineWorkspace({...})`. The workspace
 * owns the services, keyed by name, and each application lists the names of
 * the services it exposes. Service entries are opaque as in `AppConfigSchema`,
 * except for what the workspace adds to them: an `env` that overrides root
 * `env` values, and the rejection of `external`.
 */
export const WorkspaceConfigSchema = z
  .strictObject({
    ...workspaceSettingsShape,
    db: serviceRecordSchema.optional(),
    resolver: serviceRecordSchema.optional(),
    auth: serviceRecordSchema.optional(),
    idp: serviceRecordSchema.optional(),
    apps: z.record(z.string(), workspaceApplicationSchema),
  })
  .superRefine((config, ctx) => {
    const rootEnv = config.env ?? {};
    for (const service of ["db", "resolver", "auth", "idp"] as const) {
      for (const [name, entry] of entriesOf(config[service])) {
        rejectExternal(entry, [service, name], ctx);
      }
    }
    for (const [namespace, entry] of entriesOf(config.resolver)) {
      checkEnvOverride(entry, ["resolver", namespace], rootEnv, ctx);
    }
    checkEnvOverride(config.executor, ["executor"], rootEnv, ctx);
    checkEnvOverride(config.workflow, ["workflow"], rootEnv, ctx);
    for (const [name, entry] of entriesOf(config.auth)) {
      checkEnvOverride(entry, ["auth", name], rootEnv, ctx);
    }
    checkKeyedByName(config.auth, "auth", "auth", ctx);
    checkKeyedByName(config.idp, "idp", "IdP", ctx);

    const declared = {
      db: new Set(Object.keys(config.db ?? {})),
      resolver: new Set(Object.keys(config.resolver ?? {})),
      auth: new Set(Object.keys(config.auth ?? {})),
      idp: new Set(Object.keys(config.idp ?? {})),
    };
    for (const [appName, app] of Object.entries(config.apps)) {
      const checkListed = (service: "db" | "resolver" | "idp") => {
        for (const [index, name] of (app[service] ?? []).entries()) {
          if (!declared[service].has(name)) {
            ctx.addIssue({
              code: "custom",
              path: ["apps", appName, service, index],
              message: `'apps.${appName}.${service}' lists "${name}", which is not a key of '${service}'.`,
            });
          }
        }
      };
      checkListed("db");
      checkListed("resolver");
      if (app.auth !== undefined && !declared.auth.has(app.auth)) {
        ctx.addIssue({
          code: "custom",
          path: ["apps", appName, "auth"],
          message: `'apps.${appName}.auth' is "${app.auth}", which is not a key of 'auth'.`,
        });
      }
      checkListed("idp");
    }
  });
