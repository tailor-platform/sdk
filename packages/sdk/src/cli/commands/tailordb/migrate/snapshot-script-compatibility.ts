import { findUndefinedReferences } from "#/cli/shared/free-variables";
import { assertParsableExpression } from "#/utils/script-expr";
import type { MigrationDiff } from "./diff-calculator";
import type {
  SchemaSnapshot,
  SnapshotFieldConfig,
  SnapshotValidation,
  TailorDBSnapshotType,
} from "./snapshot-types";

function usesLegacyData(expr: string): boolean {
  return expr.includes("_data") && findUndefinedReferences(`(${expr}\n);`).has("_data");
}

function normalizeValidations(validations: SnapshotValidation[]): SnapshotValidation[] {
  const normalized: SnapshotValidation[] = [];
  let firstLegacy: SnapshotValidation | undefined;
  let checks: string[] = [];

  function flushLegacy(): void {
    if (!firstLegacy?.script) return;
    normalized.push({
      ...firstLegacy,
      script: {
        ...firstLegacy.script,
        expr: assertParsableExpression(
          `((_data) => { ${checks.join("\n")} })(_newRecord)`,
          "legacy migration validator",
        ),
      },
    });
    firstLegacy = undefined;
    checks = [];
  }

  // Keep each legacy chain together to preserve short-circuiting on its first falsy result.
  for (const validation of validations) {
    if (validation.script && usesLegacyData(validation.script.expr)) {
      firstLegacy ??= validation;
      checks.push(
        `if (!(${validation.script.expr}\n)) return ${JSON.stringify(validation.errorMessage)};`,
      );
    } else {
      flushLegacy();
      normalized.push(validation);
    }
  }
  flushLegacy();
  return normalized;
}

function normalizeField(field: SnapshotFieldConfig): SnapshotFieldConfig {
  const normalized = { ...field };
  if (field.fields) {
    normalized.fields = Object.fromEntries(
      Object.entries(field.fields).map(([name, nested]) => [name, normalizeField(nested)]),
    );
  }
  if (field.hooks) {
    normalized.hooks = { ...field.hooks };
    for (const operation of ["create", "update"] as const) {
      const hook = field.hooks[operation];
      if (hook && usesLegacyData(hook.expr)) {
        const dataExpr =
          operation === "update" ? "Object.assign({}, _oldRecord, _input)" : "_input";
        normalized.hooks[operation] = {
          ...hook,
          expr: assertParsableExpression(
            `((_data) => (${hook.expr}\n))(${dataExpr})`,
            "legacy migration hook",
          ),
        };
      }
    }
  }
  if (field.validate) {
    normalized.validate = normalizeValidations(field.validate);
  }
  return normalized;
}

function normalizeTable(table: TailorDBSnapshotType): TailorDBSnapshotType {
  return {
    ...table,
    fields: Object.fromEntries(
      Object.entries(table.fields).map(([name, field]) => [name, normalizeField(field)]),
    ),
  };
}

/**
 * Adapt persisted field scripts without changing the current parser's script contract.
 * @param snapshot - Validated snapshot with current structural names
 * @returns Snapshot with legacy field scripts adapted in memory
 */
export function normalizeSnapshotScriptCompatibility(snapshot: SchemaSnapshot): SchemaSnapshot {
  return {
    ...snapshot,
    tables: Object.fromEntries(
      Object.entries(snapshot.tables).map(([name, table]) => [name, normalizeTable(table)]),
    ),
  };
}

/**
 * Adapt both sides of persisted changes before replay or pre-migration planning.
 * @param diff - Validated diff with current structural names
 * @returns Diff with legacy field scripts adapted in memory
 */
export function normalizeDiffScriptCompatibility(diff: MigrationDiff): MigrationDiff {
  return {
    ...diff,
    changes: diff.changes.map((change) => {
      switch (change.kind) {
        case "table_added":
          return { ...change, after: normalizeTable(change.after) };
        case "table_removed":
          return { ...change, before: normalizeTable(change.before) };
        case "table_renamed":
          return {
            ...change,
            before: normalizeTable(change.before),
            after: normalizeTable(change.after),
          };
        case "field_added":
          return { ...change, after: normalizeField(change.after) };
        case "field_removed":
          return { ...change, before: normalizeField(change.before) };
        case "field_modified":
        case "field_type_modified":
        case "field_renamed":
          return {
            ...change,
            before: normalizeField(change.before),
            after: normalizeField(change.after),
          };
        default:
          return change;
      }
    }),
  };
}
