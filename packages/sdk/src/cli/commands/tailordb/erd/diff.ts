import { buildViewerHtml } from "./viewer";
import type {
  TailorDbErdColumn,
  TailorDbErdIndex,
  TailorDbErdRelation,
  TailorDbErdSchema,
  TailorDbErdTable,
} from "./types";

const SCHEMA_BLOCK_PATTERN =
  /<script type="application\/json" id="erd-schema">([\s\S]*?)<\/script>/;

export type ErdDiffAction = "added" | "changed" | "removed";
export type ErdDiffEntity = "column" | "index" | "relation" | "table";

export interface ErdDiffChange {
  action: ErdDiffAction;
  entity: ErdDiffEntity;
  path: string;
  detail: string;
}

export interface ErdDiffSummary {
  added: number;
  changed: number;
  removed: number;
}

export interface ErdSchemaDiff {
  namespace: string;
  baseRevision: string;
  headRevision: string;
  changed: boolean;
  summary: ErdDiffSummary;
  changes: ErdDiffChange[];
}

export interface BuildErdSchemaDiffOptions {
  base: TailorDbErdSchema;
  head: TailorDbErdSchema;
}

export interface BuildErdDiffViewerSchemaOptions {
  base: TailorDbErdSchema;
  head: TailorDbErdSchema;
}

export interface CreateEmptyErdSchemaOptions {
  namespace: string;
  revision: string;
}

export interface RenderErdDiffHtmlOptions {
  schema: TailorDbErdSchema;
  currentSchema: TailorDbErdSchema;
  diff: ErdSchemaDiff;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function changedFields(base: object, head: object): string[] {
  const keys = [...new Set([...Object.keys(base), ...Object.keys(head)])].toSorted((a, b) =>
    a.localeCompare(b),
  );
  return keys.filter(
    (key) =>
      stableJson((base as Record<string, unknown>)[key]) !==
      stableJson((head as Record<string, unknown>)[key]),
  );
}

function detailForChangedFields(fields: string[]): string {
  return `Changed fields: ${fields.join(", ")}`;
}

function mapByName<T extends { name: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.name, item]));
}

function compareCommonNamed<T extends { name: string }>(
  baseItems: readonly T[],
  headItems: readonly T[],
  addChange: (name: string, fields: string[]) => void,
): void {
  const baseByName = mapByName(baseItems);
  const headByName = mapByName(headItems);
  const commonNames = [...baseByName.keys()]
    .filter((name) => headByName.has(name))
    .toSorted((a, b) => a.localeCompare(b));

  for (const name of commonNames) {
    const base = baseByName.get(name);
    const head = headByName.get(name);
    if (!base || !head) continue;

    const fields = changedFields(base, head);
    if (fields.length > 0) {
      addChange(name, fields);
    }
  }
}

function removedNames<T extends { name: string }>(
  baseItems: readonly T[],
  headItems: readonly T[],
): string[] {
  const headByName = mapByName(headItems);
  return baseItems
    .map((item) => item.name)
    .filter((name) => !headByName.has(name))
    .toSorted((a, b) => a.localeCompare(b));
}

function addedNames<T extends { name: string }>(
  baseItems: readonly T[],
  headItems: readonly T[],
): string[] {
  const baseByName = mapByName(baseItems);
  return headItems
    .map((item) => item.name)
    .filter((name) => !baseByName.has(name))
    .toSorted((a, b) => a.localeCompare(b));
}

function tableMetadata(table: TailorDbErdTable): object {
  return {
    backwardRelationships: table.backwardRelationships,
    description: table.description,
    forwardRelationships: table.forwardRelationships,
    pluralForm: table.pluralForm,
    source: table.source,
  };
}

function pushChange(changes: ErdDiffChange[], change: ErdDiffChange): void {
  changes.push(change);
}

function diffColumns(
  changes: ErdDiffChange[],
  tableName: string,
  baseColumns: readonly TailorDbErdColumn[],
  headColumns: readonly TailorDbErdColumn[],
): void {
  compareCommonNamed(baseColumns, headColumns, (name, fields) => {
    pushChange(changes, {
      action: "changed",
      entity: "column",
      path: `${tableName}.${name}`,
      detail: detailForChangedFields(fields),
    });
  });
  for (const name of removedNames(baseColumns, headColumns)) {
    pushChange(changes, {
      action: "removed",
      entity: "column",
      path: `${tableName}.${name}`,
      detail: "Column removed",
    });
  }
  for (const name of addedNames(baseColumns, headColumns)) {
    pushChange(changes, {
      action: "added",
      entity: "column",
      path: `${tableName}.${name}`,
      detail: "Column added",
    });
  }
}

function diffIndexes(
  changes: ErdDiffChange[],
  tableName: string,
  baseIndexes: readonly TailorDbErdIndex[],
  headIndexes: readonly TailorDbErdIndex[],
): void {
  compareCommonNamed(baseIndexes, headIndexes, (name, fields) => {
    pushChange(changes, {
      action: "changed",
      entity: "index",
      path: `${tableName}.${name}`,
      detail: detailForChangedFields(fields),
    });
  });
  for (const name of removedNames(baseIndexes, headIndexes)) {
    pushChange(changes, {
      action: "removed",
      entity: "index",
      path: `${tableName}.${name}`,
      detail: "Index removed",
    });
  }
  for (const name of addedNames(baseIndexes, headIndexes)) {
    pushChange(changes, {
      action: "added",
      entity: "index",
      path: `${tableName}.${name}`,
      detail: "Index added",
    });
  }
}

function diffTables(
  changes: ErdDiffChange[],
  baseTables: readonly TailorDbErdTable[],
  headTables: readonly TailorDbErdTable[],
): void {
  const baseByName = mapByName(baseTables);
  const headByName = mapByName(headTables);

  for (const name of removedNames(baseTables, headTables)) {
    pushChange(changes, {
      action: "removed",
      entity: "table",
      path: name,
      detail: "Table removed",
    });
  }
  for (const name of addedNames(baseTables, headTables)) {
    pushChange(changes, {
      action: "added",
      entity: "table",
      path: name,
      detail: "Table added",
    });
  }

  const commonNames = [...baseByName.keys()]
    .filter((name) => headByName.has(name))
    .toSorted((a, b) => a.localeCompare(b));
  for (const name of commonNames) {
    const base = baseByName.get(name);
    const head = headByName.get(name);
    if (!base || !head) continue;

    const tableFields = changedFields(tableMetadata(base), tableMetadata(head));
    if (tableFields.length > 0) {
      pushChange(changes, {
        action: "changed",
        entity: "table",
        path: name,
        detail: detailForChangedFields(tableFields),
      });
    }
    diffColumns(changes, name, base.columns, head.columns);
    diffIndexes(changes, name, base.indexes, head.indexes);
  }
}

function diffRelations(
  changes: ErdDiffChange[],
  baseRelations: readonly TailorDbErdRelation[],
  headRelations: readonly TailorDbErdRelation[],
): void {
  compareCommonNamed(baseRelations, headRelations, (name, fields) => {
    pushChange(changes, {
      action: "changed",
      entity: "relation",
      path: name,
      detail: detailForChangedFields(fields),
    });
  });
  for (const name of removedNames(baseRelations, headRelations)) {
    pushChange(changes, {
      action: "removed",
      entity: "relation",
      path: name,
      detail: "Relation removed",
    });
  }
  for (const name of addedNames(baseRelations, headRelations)) {
    pushChange(changes, {
      action: "added",
      entity: "relation",
      path: name,
      detail: "Relation added",
    });
  }
}

function summarize(changes: readonly ErdDiffChange[]): ErdDiffSummary {
  return {
    added: changes.filter((change) => change.action === "added").length,
    changed: changes.filter((change) => change.action === "changed").length,
    removed: changes.filter((change) => change.action === "removed").length,
  };
}

export function extractEmbeddedErdSchema(html: string): TailorDbErdSchema {
  const match = SCHEMA_BLOCK_PATTERN.exec(html);
  if (!match?.[1]) {
    throw new Error("ERD schema block not found.");
  }

  try {
    return JSON.parse(match[1]) as TailorDbErdSchema;
  } catch (error) {
    throw new Error(`Failed to parse ERD schema block: ${String(error)}`, { cause: error });
  }
}

export function createEmptyErdSchema(options: CreateEmptyErdSchemaOptions): TailorDbErdSchema {
  return {
    version: 1,
    namespace: options.namespace,
    generatedAt: new Date(0).toISOString(),
    revision: options.revision,
    source: "local",
    cleanRoom: {
      implementation: "tailor-sdk",
      notes: ["Synthetic empty schema used for ERD diff generation."],
    },
    tables: [],
    relations: [],
  };
}

export function buildErdSchemaDiff(options: BuildErdSchemaDiffOptions): ErdSchemaDiff {
  const { base, head } = options;
  if (base.namespace !== head.namespace) {
    throw new Error(
      `Cannot diff ERD schemas from different namespaces: ${base.namespace}, ${head.namespace}`,
    );
  }

  const changes: ErdDiffChange[] = [];
  diffTables(changes, base.tables, head.tables);
  diffRelations(changes, base.relations, head.relations);
  const summary = summarize(changes);

  return {
    namespace: head.namespace,
    baseRevision: base.revision,
    headRevision: head.revision,
    changed: changes.length > 0,
    summary,
    changes,
  };
}

function mergeNamedByHead<T extends { name: string }>(
  baseItems: readonly T[],
  headItems: readonly T[],
): T[] {
  const headByName = mapByName(headItems);
  const removedItems = baseItems
    .filter((item) => !headByName.has(item.name))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  return [...headItems, ...removedItems];
}

function mergeDiffViewerTable(
  baseTable: TailorDbErdTable,
  headTable: TailorDbErdTable,
): TailorDbErdTable {
  return {
    ...headTable,
    columns: mergeNamedByHead(baseTable.columns, headTable.columns),
    indexes: mergeNamedByHead(baseTable.indexes, headTable.indexes),
  };
}

function mergeDiffViewerTables(
  baseTables: readonly TailorDbErdTable[],
  headTables: readonly TailorDbErdTable[],
): TailorDbErdTable[] {
  const baseByName = mapByName(baseTables);
  const headByName = mapByName(headTables);
  const merged = headTables.map((headTable) => {
    const baseTable = baseByName.get(headTable.name);
    return baseTable ? mergeDiffViewerTable(baseTable, headTable) : headTable;
  });
  const removedTables = baseTables
    .filter((table) => !headByName.has(table.name))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  return [...merged, ...removedTables];
}

/**
 * Build the schema rendered by the diff viewer. The ordinary ERD viewer only
 * knows how to draw objects present in its schema, so the diff schema keeps
 * base-only tables, columns, indexes, and relations visible for removal
 * highlighting while preferring head-side metadata for unchanged objects.
 * @param options - Base and head schemas to merge for diff rendering.
 * @returns A TailorDB ERD schema suitable for the visual diff viewer.
 */
export function buildErdDiffViewerSchema(
  options: BuildErdDiffViewerSchemaOptions,
): TailorDbErdSchema {
  const { base, head } = options;
  if (base.namespace !== head.namespace) {
    throw new Error(
      `Cannot diff ERD schemas from different namespaces: ${base.namespace}, ${head.namespace}`,
    );
  }

  return {
    ...head,
    tables: mergeDiffViewerTables(base.tables, head.tables),
    relations: mergeNamedByHead(base.relations, head.relations),
  };
}

export function renderErdDiffHtml(options: RenderErdDiffHtmlOptions): string {
  return buildViewerHtml({
    schema: options.schema,
    currentSchema: options.currentSchema,
    diff: options.diff,
    title: `TailorDB ERD diff - ${options.diff.namespace}`,
  });
}
