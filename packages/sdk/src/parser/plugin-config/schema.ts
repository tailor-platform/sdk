import { z } from "zod";
import type { PluginBase } from "./types";

// Field type enum for plugin-generated fields
const PluginFieldTypeSchema = z.enum([
  "uuid",
  "string",
  "boolean",
  "integer",
  "float",
  "date",
  "datetime",
  "time",
  "enum",
  "nested",
]);

// Enum value schema
const EnumValueSchema = z.object({
  value: z.string(),
  description: z.string().optional(),
});

// Relation schema for plugin-generated fields
const PluginRelationSchema = z.object({
  type: z.enum(["n-1", "1-1", "1-n"]),
  targetType: z.string(),
  targetField: z.string().optional(),
});

// Base field definition schema (without nested fields to avoid circular reference)
const BasePluginFieldDefinitionSchema = z.object({
  type: PluginFieldTypeSchema,
  required: z.boolean().optional(),
  description: z.string().optional(),
  array: z.boolean().optional(),
  index: z.boolean().optional(),
  unique: z.boolean().optional(),
  allowedValues: z.array(EnumValueSchema).optional(),
  relation: PluginRelationSchema.optional(),
});

// Full field definition schema with nested fields support
export const PluginFieldDefinitionSchema: z.ZodType<{
  type:
    | "uuid"
    | "string"
    | "boolean"
    | "integer"
    | "float"
    | "date"
    | "datetime"
    | "time"
    | "enum"
    | "nested";
  required?: boolean;
  description?: string;
  array?: boolean;
  index?: boolean;
  unique?: boolean;
  allowedValues?: Array<{ value: string; description?: string }>;
  relation?: { type: "n-1" | "1-1" | "1-n"; targetType: string; targetField?: string };
  fields?: Record<string, unknown>;
}> = BasePluginFieldDefinitionSchema.extend({
  fields: z.lazy(() => z.record(z.string(), PluginFieldDefinitionSchema)).optional(),
});

// Plugin-generated type schema
export const PluginGeneratedTypeSchema = z.object({
  name: z.string(),
  fields: z.record(z.string(), PluginFieldDefinitionSchema),
  description: z.string().optional(),
  settings: z
    .object({
      pluralForm: z.string().optional(),
      aggregation: z.boolean().optional(),
      bulkUpsert: z.boolean().optional(),
    })
    .optional(),
});

// Plugin-generated resolver schema
export const PluginGeneratedResolverSchema = z.object({
  name: z.string(),
  operation: z.enum(["query", "mutation"]),
  inputFields: z.record(z.string(), PluginFieldDefinitionSchema).optional(),
  outputFields: z.record(z.string(), PluginFieldDefinitionSchema),
  body: z.string(),
});

// Plugin trigger config schema
export const PluginTriggerConfigSchema = z.object({
  kind: z.enum(["recordCreated", "recordUpdated", "recordDeleted", "schedule", "webhook"]),
  type: z.string().optional(),
  schedule: z.string().optional(),
});

// Plugin operation config schema
export const PluginOperationConfigSchema = z.object({
  kind: z.enum(["function", "webhook", "graphql", "workflow"]),
  body: z.string().optional(),
  url: z.string().optional(),
  query: z.string().optional(),
});

// Plugin-generated executor schema
export const PluginGeneratedExecutorSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  trigger: PluginTriggerConfigSchema,
  operation: PluginOperationConfigSchema,
});

// Plugin output schema
export const PluginOutputSchema = z.object({
  types: z.array(PluginGeneratedTypeSchema).optional(),
  resolvers: z.array(PluginGeneratedResolverSchema).optional(),
  executors: z.array(PluginGeneratedExecutorSchema).optional(),
});

// Custom plugin schema (object form)
export const CustomPluginSchema = z.object({
  id: z.string(),
  description: z.string(),
  // Use any for the process function since we're not strictly validating function signatures
  process: z.any(),
});

// Built-in plugin tuple schema (id, options)
export const BuiltinPluginConfigSchema = z.tuple([z.string(), z.record(z.string(), z.unknown())]);

// Base plugin config schema (before transformation)
export const BasePluginConfigSchema = z.union([BuiltinPluginConfigSchema, CustomPluginSchema]);

/**
 * Creates a PluginConfigSchema with built-in plugin support
 * @param builtinPlugins - Map of plugin IDs to their constructor functions
 * @returns Plugin config schema that transforms to PluginBase instances
 */
export function createPluginConfigSchema(
  builtinPlugins: Map<string, (options: unknown) => PluginBase>,
) {
  return z
    .union([BuiltinPluginConfigSchema, CustomPluginSchema])
    .transform((plugin) => {
      if (Array.isArray(plugin)) {
        const [id, options] = plugin;
        const constructor = builtinPlugins.get(id);
        if (constructor) {
          return constructor(options);
        }
        throw new Error(`Unknown plugin ID: ${id}`);
      }
      return plugin as PluginBase;
    })
    .brand("Plugin");
}

export type PluginConfigSchemaType = ReturnType<typeof createPluginConfigSchema>;
export type Plugin = z.output<PluginConfigSchemaType>;
