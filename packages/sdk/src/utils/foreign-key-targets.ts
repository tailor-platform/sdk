/** A field that may point at a table, and may hold fields of its own that do. */
export interface ForeignKeyTargetField {
  foreignKeyType?: string;
  foreignKeyField?: string;
  fields?: Readonly<Record<string, ForeignKeyTargetField>>;
}

/** A table, and the field of it, that a field points at. */
export interface ForeignKeyReference {
  table: string;
  field?: string;
  /** Dotted path of the referencing field from the fields passed in, e.g. `links.parentID`. */
  path: string;
}

/**
 * What fields point at, including fields inside nested fields.
 * @param fields - Fields of a table
 * @returns Referenced tables, with the referenced field when the field names one and the path of the referencing field
 */
export function collectForeignKeyReferences(
  fields: Readonly<Record<string, ForeignKeyTargetField>>,
): ForeignKeyReference[] {
  const references: ForeignKeyReference[] = [];
  const visit = (
    current: Readonly<Record<string, ForeignKeyTargetField>>,
    prefix: string,
  ): void => {
    for (const [name, field] of Object.entries(current)) {
      const path = `${prefix}${name}`;
      if (field.foreignKeyType !== undefined) {
        references.push({ table: field.foreignKeyType, field: field.foreignKeyField, path });
      }
      if (field.fields) visit(field.fields, `${path}.`);
    }
  };
  visit(fields, "");
  return references;
}

/**
 * The tables that fields point at, including fields inside nested fields.
 * @param fields - Fields of a table
 * @returns Names of the referenced tables, once each, in order of first appearance
 */
export function collectForeignKeyTargets(
  fields: Readonly<Record<string, ForeignKeyTargetField>>,
): string[] {
  return [...new Set(collectForeignKeyReferences(fields).map((reference) => reference.table))];
}
