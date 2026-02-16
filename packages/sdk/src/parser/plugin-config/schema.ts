import { cloneDeep } from "es-toolkit";
import { z } from "zod";
import { functionSchema } from "@/parser/service/common";
import { TailorFieldSchema } from "@/parser/service/resolver/schema";
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
  kind: z.enum(["recordCreated", "recordUpdated", "recordDeleted", "schedule", "incomingWebhook"]),
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

// Validates TailorAnyField shape using TailorFieldSchema,
// wrapped in z.custom to preserve runtime methods (_metadata, parse, etc.)
const tailorAnyFieldSchema = z.custom<PluginConfigSchemaField>(
  (val) => TailorFieldSchema.safeParse(val).success,
);

// Custom plugin schema (object form)
// Using passthrough() to preserve additional properties on PluginBase instances
const CustomPluginSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    importPath: z.string(),
    configSchema: tailorAnyFieldSchema.optional(),
    pluginConfigSchema: tailorAnyFieldSchema.optional(),
    pluginConfig: z.unknown().optional(),
    processType: functionSchema.optional(),
    processNamespace: functionSchema.optional(),
    typeConfigRequired: z.union([z.boolean(), functionSchema]).optional(),
    configTypeTemplate: z.string().optional(),
  })
  .superRefine((plugin, ctx) => {
    if (plugin.processType && !plugin.configSchema) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "processType requires configSchema to be defined.",
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
  return CustomPluginSchema.safeParse(value).success;
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
 * Creates a PluginConfigSchema for custom plugins
 * @returns Plugin config schema that validates and transforms PluginBase instances
 */
export function createPluginConfigSchema() {
  return z
    .union([CustomPluginSchema, CustomPluginTupleSchema])
    .transform((plugin) => {
      // Tuple form: [PluginBase, options]
      if (Array.isArray(plugin)) {
        const [first, options] = plugin;
        if (isPluginBase(first)) {
          const pluginBase = first as PluginBase;
          return normalizePluginBase({ ...pluginBase, pluginConfig: options } as PluginBase);
        }
        throw new Error(`Invalid plugin configuration: expected PluginBase object`);
      }
      // Object form: custom plugin without plugin config
      return normalizePluginBase(plugin as PluginBase);
    })
    .brand("Plugin");
}

export type PluginConfigSchemaType = ReturnType<typeof createPluginConfigSchema>;
export type Plugin = z.output<PluginConfigSchemaType>;
