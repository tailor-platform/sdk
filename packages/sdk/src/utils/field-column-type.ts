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

/** The select and write types a `ColumnType`-shaped alias expands to. */
export type ColumnTypeAliasExpansion = {
  /** Type the alias reads back as. */
  readonly select: string;
  /** Type the alias accepts on insert and update. */
  readonly write: string;
};

/**
 * Column types whose alias expands to a `ColumnType`, mapped to that expansion.
 *
 * Kysely only unwraps a `ColumnType` at the top level of a table property, so an
 * array of one of these stays wrapped in `ArrayColumnType<...>` rather than taking
 * a `[]` suffix, which would nest the `ColumnType` out of Kysely's reach. Where a
 * generator has to spell out the slots itself, it reads the expansion from here
 * rather than inlining the alias, which would nest just the same.
 *
 * Both type generators track alias usage per alias to decide which declarations to
 * emit, so adding an entry here also means teaching them to report the new alias.
 */
export const COLUMN_TYPE_ALIASES: ReadonlyMap<string, ColumnTypeAliasExpansion> = new Map<
  FieldColumnType,
  ColumnTypeAliasExpansion
>([["Timestamp", { select: "Date", write: "Date | string" }]]);
