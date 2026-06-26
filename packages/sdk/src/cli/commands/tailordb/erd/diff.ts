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

export interface CreateEmptyErdSchemaOptions {
  namespace: string;
  revision: string;
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
    description: table.description,
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function schemaDataJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
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

export function renderErdDiffHtml(diff: ErdSchemaDiff): string {
  const rows = diff.changes.length
    ? diff.changes
        .map(
          (change) => `<tr class="${change.action}">
            <td>${escapeHtml(change.action)}</td>
            <td>${escapeHtml(change.entity)}</td>
            <td><code>${escapeHtml(change.path)}</code></td>
            <td>${escapeHtml(change.detail)}</td>
          </tr>`,
        )
        .join("\n")
    : '<tr><td colspan="4">No ERD schema changes.</td></tr>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TailorDB ERD diff - ${escapeHtml(diff.namespace)}</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; background: #f7f8fb; color: #172033; }
      main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 48px; }
      h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.2; }
      .meta { margin: 0 0 24px; color: #5a6475; }
      .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0 0 24px; }
      .summary div { border: 1px solid #d9dee8; border-radius: 8px; background: #fff; padding: 16px; }
      .summary span { display: block; color: #5a6475; font-size: 13px; }
      .summary strong { display: block; font-size: 26px; margin-top: 6px; }
      table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d9dee8; border-radius: 8px; overflow: hidden; }
      th, td { padding: 10px 12px; border-bottom: 1px solid #e6e9f0; text-align: left; vertical-align: top; }
      th { background: #eef2f7; color: #384256; font-size: 13px; }
      tr:last-child td { border-bottom: 0; }
      code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 13px; }
      tr.added td:first-child { color: #116329; font-weight: 600; }
      tr.changed td:first-child { color: #8a4b08; font-weight: 600; }
      tr.removed td:first-child { color: #a40e26; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <h1>TailorDB ERD diff - ${escapeHtml(diff.namespace)}</h1>
      <p class="meta">Base revision <code>${escapeHtml(diff.baseRevision)}</code> -> head revision <code>${escapeHtml(diff.headRevision)}</code></p>
      <section class="summary" aria-label="ERD diff summary">
        <div><span>Added</span><strong>${diff.summary.added}</strong></div>
        <div><span>Changed</span><strong>${diff.summary.changed}</strong></div>
        <div><span>Removed</span><strong>${diff.summary.removed}</strong></div>
      </section>
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>Entity</th>
            <th>Path</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </main>
    <script type="application/json" id="erd-diff">${schemaDataJson(diff)}</script>
  </body>
</html>
`;
}
