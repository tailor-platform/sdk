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

// Custom plugin schema (object form)
const CustomPluginSchema = z.object({
  id: z.string(),
  description: z.string(),
  // Use any for the process function since we're not strictly validating function signatures
  process: z.any(),
});

// Built-in plugin tuple schema (id, options)
const BuiltinPluginConfigSchema = z.tuple([z.string(), z.record(z.string(), z.unknown())]);

// Base plugin config schema (before transformation)
const _BasePluginConfigSchema = z.union([BuiltinPluginConfigSchema, CustomPluginSchema]);

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
