import * as v from "valibot";
import { stripTailorDBTypeBuilderHelpers } from "#/parser/service/tailordb/builder-helpers";
/**
 * Internal test utilities for SDK development.
 * These are NOT exported to library users.
 */
import { TailorDBTypeSchema } from "#/parser/service/tailordb/schema";
import type { TailorDBTypeRaw as TailorDBTypeSchemaOutput } from "#/types/tailordb.generated";

/**
 * Converts a single db.table() result to schema-parsed output for testing.
 * In production, this conversion happens in application loader.
 * @param type - The db.table() result to convert
 * @returns Parsed TailorDB type schema output
 */
export function toSchemaOutput(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accept any db.table() result for testing
  type: any,
): TailorDBTypeSchemaOutput {
  const parsed = v.safeParse(TailorDBTypeSchema, stripTailorDBTypeBuilderHelpers(type));
  if (!parsed.success) {
    const message = parsed.issues
      .map((issue) => {
        const path = issue.path?.map((segment) => segment.key).join(".");
        return path ? `${issue.message} at "${path}"` : issue.message;
      })
      .join("; ");
    throw new Error(`Failed to parse type ${type.name}: ${message}`);
  }
  return parsed.output;
}

/**
 * Converts multiple db.table() results to schema-parsed outputs for testing.
 * In production, this conversion happens in application loader.
 * @param types - Record of db.table() results to convert
 * @returns Record of parsed TailorDB type schema outputs
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
