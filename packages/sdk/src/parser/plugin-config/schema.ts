import { cloneDeep } from "es-toolkit";
import { z } from "zod";
import type { PluginBase } from "./types";

type PluginConfigSchemaField = NonNullable<PluginBase["configSchema"]>;

type UnauthenticatedTailorUser = {
  id: string;
  type: "" | "machine_user" | "user";
  workspaceId: string;
  attributes: null | Record<string, string | string[] | boolean | boolean[] | undefined>;
  attributeList: [];
};

const unauthenticatedTailorUser: UnauthenticatedTailorUser = {
  id: "00000000-0000-0000-0000-000000000000",
  type: "",
  workspaceId: "00000000-0000-0000-0000-000000000000",
  attributes: null,
  attributeList: [],
};

// Plugin-generated type schema - accepts TailorDBType instances (from db.type())
// We only validate the minimal interface: name and fields properties
const PluginGeneratedTypeSchema = z.object({
  name: z.string(),
  fields: z.record(z.string(), z.unknown()),
});

// Plugin-generated resolver schema
const PluginGeneratedResolverSchema = z.object({
  name: z.string(),
  operation: z.enum(["query", "mutation"]),
  inputFields: z.record(z.string(), z.unknown()).optional(),
  outputFields: z.record(z.string(), z.unknown()),
  body: z.string(),
});

// Plugin trigger config schema
const PluginTriggerConfigSchema = z.object({
  kind: z.enum(["recordCreated", "recordUpdated", "recordDeleted", "schedule", "webhook"]),
  type: z.string().optional(),
  schedule: z.string().optional(),
});

// Plugin operation config schema
const PluginOperationConfigSchema = z.object({
  kind: z.enum(["function", "webhook", "graphql", "workflow"]),
  body: z.string().optional(),
  url: z.string().optional(),
  query: z.string().optional(),
});

// Plugin-generated executor schema
const PluginGeneratedExecutorSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  trigger: PluginTriggerConfigSchema,
  operation: PluginOperationConfigSchema,
});

// Plugin output schema (unused, kept for documentation)
const _PluginOutputSchema = z.object({
  types: z.array(PluginGeneratedTypeSchema).optional(),
  resolvers: z.array(PluginGeneratedResolverSchema).optional(),
  executors: z.array(PluginGeneratedExecutorSchema).optional(),
});

// Literal-based schema for built-in changeset plugin (enables autocomplete)
const ChangesetPluginSchema = z.literal("@tailor-platform/changeset");

// Built-in plugin tuple schema (id, options)
const BuiltinPluginTupleSchema = z.tuple([ChangesetPluginSchema, z.unknown()]);

// Custom plugin schema (object form)
// Using passthrough() to preserve fields like importPath, configSchema, processNamespace
const CustomPluginSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    importPath: z.string(),
    configSchema: z.any().optional(),
    pluginConfigSchema: z.any().optional(),
    pluginConfig: z.any().optional(),
    // Use any for the process function since we're not strictly validating function signatures
    process: z.any().optional(),
    processNamespace: z.any().optional(),
  })
  .superRefine((plugin, ctx) => {
    if (plugin.process && !plugin.configSchema) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "process requires configSchema to be defined.",
        path: ["configSchema"],
      });
    }
  })
  .passthrough();

// Custom plugin tuple schema (PluginBase, options)
// Allows custom plugins to receive plugin config via definePlugins()
const CustomPluginTupleSchema = z.tuple([CustomPluginSchema, z.unknown()]);

/**
 * Type guard to check if a value is a PluginBase object
 * @param value - Value to check
 * @returns True if value is a PluginBase object
 */
function isPluginBase(value: unknown): value is PluginBase {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "description" in value &&
    "importPath" in value
  );
}

function normalizePluginConfigSchema(schema: PluginConfigSchemaField): PluginConfigSchemaField {
  const seen = new Set<PluginConfigSchemaField>();
  const stack: PluginConfigSchemaField[] = [schema];

  while (stack.length > 0) {
    const field = stack.pop();
    if (!field || seen.has(field)) {
      continue;
    }
    seen.add(field);

    const requiredExplicit = field._metadata.requiredExplicit === true;
    field._metadata.required = requiredExplicit;

    for (const nestedField of Object.values(field.fields)) {
      stack.push(nestedField);
    }
  }

  return schema;
}

function clonePluginConfigSchema(schema: PluginConfigSchemaField): PluginConfigSchemaField {
  return cloneDeep(schema) as PluginConfigSchemaField;
}

function normalizePluginBase(plugin: PluginBase): PluginBase {
  let normalized = plugin;

  if (normalized.configSchema) {
    const clonedConfigSchema = clonePluginConfigSchema(normalized.configSchema);
    normalizePluginConfigSchema(clonedConfigSchema);
    normalized = { ...normalized, configSchema: clonedConfigSchema };
  }

  if (normalized.pluginConfigSchema) {
    const pluginConfigSchema = clonePluginConfigSchema(normalized.pluginConfigSchema);
    normalizePluginConfigSchema(pluginConfigSchema);
    normalized = { ...normalized, pluginConfigSchema };
    if (normalized.pluginConfig !== undefined) {
      const validationErrors = validatePluginConfig(normalized.pluginConfig, pluginConfigSchema);
      if (validationErrors.length > 0) {
        const errorDetails = validationErrors
          .map((e) => (e.field ? `${e.field}: ${e.message}` : e.message))
          .join("; ");
        throw new Error(`Invalid pluginConfig for plugin "${normalized.id}": ${errorDetails}`);
      }
    }
  }
  return normalized;
}

/**
 * Validate plugin config against its schema
 * @param config - The config object to validate
 * @param schema - The schema defining expected fields
 * @returns Array of validation errors (empty if valid)
 */
function validatePluginConfig(
  config: unknown,
  schema: PluginConfigSchemaField,
): Array<{ field: string; message: string }> {
  const result = schema.parse({
    value: config,
    data: config,
    user: unauthenticatedTailorUser,
  });

  if ("issues" in result && result.issues) {
    return result.issues.map((issue) => ({
      field: Array.isArray(issue.path) ? issue.path.join(".") : "",
      message: issue.message,
    }));
  }

  return [];
}

/**
 * Creates a PluginConfigSchema with built-in plugin support
 * @param builtinPlugins - Map of plugin IDs to their constructor functions
 * @returns Plugin config schema that transforms to PluginBase instances
 */
export function createPluginConfigSchema(
  builtinPlugins: Map<string, (options: unknown) => PluginBase>,
) {
  return z
    .union([
      ChangesetPluginSchema,
      BuiltinPluginTupleSchema,
      CustomPluginSchema,
      CustomPluginTupleSchema,
    ])
    .transform((plugin) => {
      // String form: builtin plugin ID only (use true as default config)
      if (typeof plugin === "string") {
        const constructor = builtinPlugins.get(plugin);
        if (constructor) {
          return constructor(true);
        }
        throw new Error(`Unknown plugin ID: ${plugin}`);
      }
      // Tuple form: check if it's [string, options] or [PluginBase, options]
      if (Array.isArray(plugin)) {
        const [first, options] = plugin;
        // Builtin plugin tuple: ["@tailor-platform/changeset", options]
        if (typeof first === "string") {
          const constructor = builtinPlugins.get(first);
          if (constructor) {
            return constructor(options);
          }
          throw new Error(`Unknown plugin ID: ${first}`);
        }
        // Custom plugin tuple: [PluginBase, options]
        if (isPluginBase(first)) {
          const pluginBase = first as PluginBase;
          return normalizePluginBase({ ...pluginBase, pluginConfig: options } as PluginBase);
        }
        throw new Error(`Invalid plugin configuration: expected PluginBase object or builtin ID`);
      }
      // Object form: custom plugin without plugin config
      return normalizePluginBase(plugin as PluginBase);
    })
    .brand("Plugin");
}

export type PluginConfigSchemaType = ReturnType<typeof createPluginConfigSchema>;
export type Plugin = z.output<PluginConfigSchemaType>;
