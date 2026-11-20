import { stripTailorDBTypeBuilderHelpers } from "#/parser/service/tailordb/builder-helpers";
/**
 * Internal test utilities for SDK development.
 * These are NOT exported to library users.
 */
import { TailorDBTypeSchema } from "#/parser/service/tailordb/schema";
import { parseTypes } from "#/parser/service/tailordb/type-parser";
import { buildTypeScripts, type TypeScripts } from "#/parser/service/tailordb/type-script";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "#/types/tailordb.generated";

/**
 * Converts a single db.table() result to schema-parsed output for testing.
 * In production, this conversion happens in application loader.
 * @param type - The db.table() result to convert
 * @returns Parsed TailorDB table schema output
 */
export function toSchemaOutput(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accept any db.table() result for testing
  type: any,
): TailorDBTypeSchemaOutput {
  const parsed = TailorDBTypeSchema.safeParse(stripTailorDBTypeBuilderHelpers(type));
  if (!parsed.success) {
    throw new Error(`Failed to parse table ${type.name}: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Converts multiple db.table() results to schema-parsed outputs for testing.
 * In production, this conversion happens in application loader.
 * @param types - Record of db.table() results to convert
 * @returns Record of parsed TailorDB table schema outputs
 */
export function toSchemaOutputs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accept any db.table() result for testing
  types: Record<string, any>,
): Record<string, TailorDBTypeSchemaOutput> {
  const result = Object.create(null) as Record<string, TailorDBTypeSchemaOutput>;
  for (const [name, type] of Object.entries(types)) {
    result[name] = toSchemaOutput(type);
  }
  return result;
}

/**
 * Compiles a db.table() result's hooks, defaults, and validators into table-level scripts.
 * @param type - The db.table() result to compile
 * @returns The table's hook and validate scripts
 */
export function buildTableScripts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accept any db.table() result for testing
  type: any,
): TypeScripts {
  const parsed = parseTypes({ [type.name]: toSchemaOutput(type) }, "ns")[type.name];
  if (!parsed) {
    throw new Error(`Failed to parse table ${type.name}`);
  }
  const fields = Object.fromEntries(
    Object.entries(parsed.fields).map(([name, field]) => [name, field.config]),
  );
  return buildTypeScripts(fields, {
    typeHookExpr: parsed.typeHookExpr,
    typeValidateExpr: parsed.typeValidateExpr,
  });
}
