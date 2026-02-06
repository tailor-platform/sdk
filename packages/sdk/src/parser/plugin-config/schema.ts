import { z } from "zod";
import type { PluginBase } from "./types";

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

// Literal-based schemas for built-in plugins (enables autocomplete)
const ChangesetPluginSchema = z.literal("@tailor-platform/changeset");
const AuditLogPluginSchema = z.literal("@tailor-platform/audit-log");
const ChangeHistoryPluginSchema = z.literal("@tailor-platform/change-history");

// Union of all built-in plugin IDs (for autocomplete)
const BuiltinPluginIdSchema = z.union([
  ChangesetPluginSchema,
  AuditLogPluginSchema,
  ChangeHistoryPluginSchema,
]);

// Custom plugin schema (object form)
// Using passthrough() to preserve fields like importPath, configSchema, processStandalone
const CustomPluginSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    importPath: z.string(),
    configSchema: z.any(),
    pluginConfigSchema: z.any().optional(),
    // Use any for the process function since we're not strictly validating function signatures
    process: z.any().optional(),
    processStandalone: z.any().optional(),
  })
  .passthrough();

// Built-in plugin tuple schema (id, options) for future use
// Currently built-in plugins don't use pluginConfig, but this allows it
const BuiltinPluginTupleSchema = z.tuple([BuiltinPluginIdSchema, z.unknown()]);

// Custom plugin tuple schema (PluginBase, options)
// Allows custom plugins to receive pluginConfig via definePlugins()
const CustomPluginTupleSchema = z.tuple([CustomPluginSchema, z.unknown()]);

// Base schema for plugin config input (kept for documentation)
const _BasePluginConfigSchema = z.union([
  BuiltinPluginIdSchema,
  BuiltinPluginTupleSchema,
  CustomPluginSchema,
  CustomPluginTupleSchema,
]);

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
      BuiltinPluginIdSchema,
      BuiltinPluginTupleSchema,
      CustomPluginSchema,
      CustomPluginTupleSchema,
    ])
    .transform((plugin) => {
      // String form: plugin ID only (use true as default config)
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
        // [PluginBase, options] form: custom plugin with pluginConfig
        if (isPluginBase(first)) {
          const pluginBase = first as PluginBase;
          return { ...pluginBase, _pluginConfig: options } as PluginBase;
        }
        // [string, options] form: builtin plugin with options
        const constructor = builtinPlugins.get(first as string);
        if (constructor) {
          return constructor(options);
        }
        throw new Error(`Unknown plugin ID: ${first}`);
      }
      // Object form: custom plugin without pluginConfig
      return plugin as PluginBase;
    })
    .brand("Plugin");
}

export type PluginConfigSchemaType = ReturnType<typeof createPluginConfigSchema>;
export type Plugin = z.output<PluginConfigSchemaType>;
