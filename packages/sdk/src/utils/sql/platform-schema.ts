/**
 * The JSON TailorDB stores for each type of a namespace, which its SQL analyzer reads tables from.
 * It has only what decides whether the analyzer accepts a statement and which types it gives:
 * hooks, validations, indexes, decimal scales, and permissions are left out, and every field says
 * it has no foreign key, which the analyzer never reads.
 */

/** The parts of a TailorDB field definition the schema has. */
export interface PlatformSchemaFieldConfig {
  type: string;
  required?: boolean;
  array?: boolean;
  unique?: boolean;
  vector?: boolean;
  allowedValues?: { value: string }[];
  fields?: Record<string, PlatformSchemaFieldConfig>;
}

/** The parts of a parsed TailorDB table the schema has. */
export interface PlatformSchemaTable {
  name: string;
  fields: Record<string, { config: PlatformSchemaFieldConfig }>;
}

/** A field as TailorDB stores it. */
interface PlatformStoredField {
  _type: string;
  _required: boolean;
  _array: boolean;
  _unique: boolean;
  _vector: boolean;
  _foreignKey: false;
  _allowedValues?: { value: string }[];
  fields?: Record<string, PlatformStoredField>;
}

/** A type as TailorDB stores it. */
export interface PlatformStoredType {
  _settings: { publishRecordEvents: boolean };
  fields: Record<string, PlatformStoredField>;
}

/**
 * Whether TailorDB requires a value for the field, which a field is unless it says otherwise, as
 * deploy sends it.
 * @param config - Field definition
 * @returns Whether the field is required
 */
export function isRequired(config: Pick<PlatformSchemaFieldConfig, "required">): boolean {
  return config.required !== false;
}

function storedField(config: PlatformSchemaFieldConfig): PlatformStoredField {
  return {
    _type: config.type,
    _required: isRequired(config),
    _array: config.array ?? false,
    _unique: config.unique ?? false,
    _vector: config.vector ?? false,
    _foreignKey: false,
    ...(config.type === "enum" && {
      _allowedValues: (config.allowedValues ?? []).map(({ value }) => ({ value })),
    }),
    ...(config.type === "nested" &&
      config.fields && {
        fields: Object.fromEntries(
          Object.entries(config.fields).map(([name, field]) => [name, storedField(field)]),
        ),
      }),
  };
}

/**
 * Write the tables of one namespace as TailorDB stores them, keyed by type name.
 * @param tables - The namespace's tables
 * @returns The schema the SQL analyzer reads
 */
export function platformSchemaOf(
  tables: readonly PlatformSchemaTable[],
): Record<string, PlatformStoredType> {
  return Object.fromEntries(
    tables.map((table) => [
      table.name,
      {
        _settings: { publishRecordEvents: false },
        fields: Object.fromEntries(
          Object.entries(table.fields)
            .filter(([name]) => name !== "id")
            .map(([name, field]) => [name, storedField(field.config)]),
        ),
      },
    ]),
  );
}
