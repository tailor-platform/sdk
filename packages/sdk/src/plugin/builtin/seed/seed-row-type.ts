/** The part of a parsed field config the seed row type is built from. */
export interface SeedRowFieldConfig {
  type: string;
  required?: boolean;
  array?: boolean;
  allowedValues?: readonly (string | { value: string })[];
  fields?: Readonly<Record<string, SeedRowFieldConfig>>;
}

/** Parameters of {@link generateSeedRowType}. */
export interface SeedRowTypeParams {
  /** Fields of the table, keyed by field name. */
  fields: Readonly<Record<string, SeedRowFieldConfig>>;
  /** Fields a seed row may leave out because the platform fills them in. */
  optionalFields: readonly string[];
  /** Fields the platform assigns, which a seed row does not carry. */
  omitFields: readonly string[];
}

function scalarType(type: string): string {
  switch (type) {
    case "integer":
    case "float":
      return "number";
    case "bool":
    case "boolean":
      return "boolean";
    case "datetime":
      return "string | Date";
    default:
      return "string";
  }
}

function enumType(allowedValues: SeedRowFieldConfig["allowedValues"]): string {
  if (!allowedValues || allowedValues.length === 0) return "string";
  return allowedValues
    .map((value) => JSON.stringify(typeof value === "string" ? value : value.value))
    .join(" | ");
}

function valueType(field: SeedRowFieldConfig, nullable: boolean): string {
  const base =
    field.type === "enum"
      ? enumType(field.allowedValues)
      : field.type === "nested"
        ? `{ ${members(field.fields ?? {}, [], [])
            .join(" ")
            .replace(/;$/, "")} }`
        : scalarType(field.type);
  const element = field.array ? `${base.includes(" | ") ? `(${base})` : base}[]` : base;
  return nullable ? `${element} | null` : element;
}

function members(
  fields: Readonly<Record<string, SeedRowFieldConfig>>,
  optionalFields: readonly string[],
  omitFields: readonly string[],
): string[] {
  return Object.entries(fields)
    .filter(([name]) => !omitFields.includes(name))
    .map(([name, field]) => {
      const optional = field.required !== true || optionalFields.includes(name);
      return `${name}${optional ? "?" : ""}: ${valueType(field, optional)};`;
    });
}

/**
 * Writes the type of a seed row of a table whose fields are known only when the seed schema is
 * generated, such as a table a plugin generates. A field takes the type the same field has in the
 * seed schema of a table the user defines.
 * @param params - Fields of the table and which of them a seed row may leave out or never carries
 * @returns The type as TypeScript source
 */
export function generateSeedRowType(params: SeedRowTypeParams): string {
  const { fields, optionalFields, omitFields } = params;
  const withId = "id" in fields ? fields : { id: { type: "uuid", required: true }, ...fields };
  const lines = members(withId, optionalFields, omitFields);
  return `{\n${lines.map((line) => `  ${line}`).join("\n")}\n}`;
}
