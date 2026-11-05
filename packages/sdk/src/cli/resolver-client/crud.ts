import type { RecordTypeMeta, RelationMeta } from "#/client/records";
import type {
  OperatorFieldConfig,
  ParsedField,
  TailorDBType,
} from "#/parser/service/tailordb/types";

const SORTABLE_TYPES = new Set([
  "string",
  "integer",
  "float",
  "decimal",
  "boolean",
  "date",
  "time",
  "enum",
  "datetime",
]);

function toCamel(name: string): string {
  return name
    .split(/[ \-_.]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function toLowerCamel(name: string): string {
  const camel = toCamel(name);
  return camel.charAt(0).toLowerCase() + camel.slice(1);
}

function selectionOfConfig(name: string, config: OperatorFieldConfig): string {
  return config.fields ? `${name} { ${selectionOfConfigs(config.fields)} }` : name;
}

function selectionOfConfigs(configs: Record<string, OperatorFieldConfig>): string {
  return Object.entries(configs)
    .map(([name, config]) => selectionOfConfig(name, config))
    .join(" ");
}

/**
 * Select each field of a TailorDB type by its name, with the fields inside a
 * nested object. Relations to other types are not part of a type's own fields.
 * @param fields - Fields of the type
 * @returns What to select for each field, in the order the type declares them
 */
export function fieldSelections(fields: Record<string, ParsedField>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [name, selectionOfConfig(name, field.config)]),
  );
}

function hasSortableField(fields: Record<string, ParsedField>): boolean {
  return Object.values(fields).some(
    ({ config }) => SORTABLE_TYPES.has(config.type) && !config.array,
  );
}

function relationsOf(
  type: TailorDBType,
  types: Record<string, TailorDBType>,
): Record<string, RelationMeta> {
  const relations: Record<string, RelationMeta> = {};
  const declared = { ...type.forwardRelationships, ...type.backwardRelationships };
  for (const [name, relation] of Object.entries(declared)) {
    const target = types[relation.targetType];
    if (!target) continue;
    relations[name] = {
      typeName: toCamel(target.name),
      fields: fieldSelections(target.fields),
      sortable: hasSortableField(target.fields),
      many: relation.isArray,
    };
  }
  return relations;
}

/**
 * Describe a TailorDB type to the client: how the platform names its
 * operations, which fields to select, and the relations that can be included.
 * @param type - Parsed TailorDB type
 * @param types - Every TailorDB type of the project by name, to find the targets of relations
 * @returns What the client builds the type's operations from
 */
export function buildRecordMeta(
  type: TailorDBType,
  types: Record<string, TailorDBType>,
): RecordTypeMeta {
  return {
    typeName: toCamel(type.name),
    one: toLowerCamel(type.name),
    many: toLowerCamel(type.pluralForm),
    fields: fieldSelections(type.fields),
    sortable: hasSortableField(type.fields),
    relations: relationsOf(type, types),
  };
}
