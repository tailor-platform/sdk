import { stripTailorDBTypeBuilderHelpers } from "#/parser/service/tailordb/builder-helpers";
/**
 * Internal test utilities for SDK development.
 * These are NOT exported to library users.
 */
import { TailorDBTypeSchema } from "#/parser/service/tailordb/schema";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "#/types/tailordb.generated";

/**
 * Converts a single db.type() result to schema-parsed output for testing.
 * In production, this conversion happens in application loader.
 * @param type - The db.type() result to convert
 * @returns Parsed TailorDB type schema output
 */
export function toSchemaOutput(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accept any db.type() result for testing
  type: any,
): TailorDBTypeSchemaOutput {
  const parsed = TailorDBTypeSchema.safeParse(stripTailorDBTypeBuilderHelpers(type));
  if (!parsed.success) {
    throw new Error(`Failed to parse type ${type.name}: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Converts multiple db.type() results to schema-parsed outputs for testing.
 * In production, this conversion happens in application loader.
 * @param types - Record of db.type() results to convert
 * @returns Record of parsed TailorDB type schema outputs
 */
export function toSchemaOutputs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accept any db.type() result for testing
  types: Record<string, any>,
): Record<string, TailorDBTypeSchemaOutput> {
  const result = Object.create(null) as Record<string, TailorDBTypeSchemaOutput>;
  for (const [name, type] of Object.entries(types)) {
    result[name] = toSchemaOutput(type);
  }
  return result;
}
