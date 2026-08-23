/** The Kysely column type a TailorDB field maps to, before array/null modifiers. */
export type FieldColumnType = "string" | "number" | "boolean" | "Timestamp";

/**
 * Map a scalar TailorDB field type to the column type generated code uses for it.
 *
 * `date` resolves to `Timestamp` because the function runtime hands back a
 * `Date` for a date column, same as for datetime.
 *
 * `enum` and `nested` carry their own shape, so each generator resolves them
 * before reaching here; passing either is a caller bug rather than a `string`
 * column.
 * @param fieldType - TailorDB scalar field type name
 * @returns The column type for the field, defaulting to `string`
 * @throws If given `enum` or `nested`
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
    case "enum":
    case "nested":
      throw new Error(
        `Field type "${fieldType}" has no scalar column type; resolve it before mapping.`,
      );
    default:
      return "string";
  }
}
