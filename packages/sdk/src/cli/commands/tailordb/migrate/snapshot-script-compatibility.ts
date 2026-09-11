import { findUndefinedReferences } from "#/cli/shared/free-variables";
import { assertParsableExpression } from "#/utils/script-expr";
import type {
  SnapshotFieldConfig,
  SnapshotValidation,
  TailorDBSnapshotType,
} from "./snapshot-types";

function usesLegacyData(expr: string): boolean {
  return (
    expr.includes("_data") &&
    findUndefinedReferences(`(${expr}\n);`, { includeGuardedReferences: true }).has("_data")
  );
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

function mergeRecordExpression(oldRecord: string, input: string): string {
  return `(function merge(oldValue, newValue) {
    if (newValue === undefined) return oldValue;
    if (newValue === null || typeof newValue !== "object" || Array.isArray(newValue)
      || Object.getPrototypeOf(newValue) !== Object.prototype) return newValue;
    return Object.fromEntries([
      ...Object.entries(oldValue ?? {}),
      ...Object.entries(newValue).map(([key, value]) => [key, merge(oldValue?.[key], value)])
    ]);
  })(${oldRecord}, ${input})`;
}

function normalizeField(
  field: SnapshotFieldConfig,
  inputAccess: string,
  oldAccess: string,
  fieldName: string,
): SnapshotFieldConfig {
  const normalized = { ...field };
  if (field.fields) {
    // The script compiler binds __el while evaluating hooks in array elements.
    const nestedInput = field.array ? "__el" : `${inputAccess}?.[${JSON.stringify(fieldName)}]`;
    const nestedOld = field.array ? "undefined" : `${oldAccess}?.[${JSON.stringify(fieldName)}]`;
    normalized.fields = Object.fromEntries(
      Object.entries(field.fields).map(([name, nested]) => [
        name,
        normalizeField(nested, nestedInput, nestedOld, name),
      ]),
    );
  }
  if (field.hooks) {
    normalized.hooks = { ...field.hooks };
    for (const operation of ["create", "update"] as const) {
      const hook = field.hooks[operation];
      if (hook && usesLegacyData(hook.expr)) {
        const dataExpr =
          operation === "update" ? mergeRecordExpression(oldAccess, inputAccess) : inputAccess;
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

/**
 * Adapt historical scripts for execution while leaving persisted metadata unchanged.
 * @param table - Table whose field scripts will be compiled
 * @returns Table with legacy field scripts adapted in memory
 */
export function normalizeTableScriptCompatibility(
  table: TailorDBSnapshotType,
): TailorDBSnapshotType {
  return {
    ...table,
    fields: Object.fromEntries(
      Object.entries(table.fields).map(([name, field]) => [
        name,
        normalizeField(field, "_input", "_oldRecord", name),
      ]),
    ),
  };
}
