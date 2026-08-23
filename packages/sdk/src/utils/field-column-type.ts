/** The Kysely column type a TailorDB field maps to, before array/null modifiers. */
export type FieldColumnType = "string" | "number" | "boolean" | "Timestamp";

/**
 * Map a TailorDB field type to the column type generated code uses for it.
 *
 * `date` resolves to `Timestamp` because the function runtime hands back a
 * `Date` for a date column, same as for datetime.
 * @param fieldType - TailorDB field type name
 * @returns The column type for the field, defaulting to `string`
 */
export function mapFieldTypeToColumnType(fieldType: string): FieldColumnType {
  switch (fieldType) {
    case "uuid":
    case "string":
    case "decimal":
      return "string";
    case "integer":
    case "float":
    case "number":
      return "number";
    case "date":
    case "datetime":
      return "Timestamp";
    case "bool":
    case "boolean":
      return "boolean";
    default:
      return "string";
  }
}
