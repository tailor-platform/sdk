import type { DDLFieldConfig, DDLTableConfig } from "@tailor-platform/sdk/plugin";

function stringLiteralType(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function enumColumnType(field: DDLFieldConfig): string | undefined {
  if (field.type !== "enum" || !field.allowedValues?.length) return undefined;
  const union = field.allowedValues.map(({ value }) => stringLiteralType(value)).join(" | ");
  return field.array ? `(${union})[]` : union;
}

/**
 * Column types SafeQL cannot infer from `text`, keyed `"<table>.<column>"`.
 * @param tables - Tables the DDL was generated from
 * @returns SafeQL `overrides.columns` entries
 */
export function columnTypeOverrides(tables: readonly DDLTableConfig[]): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const table of tables) {
    for (const [column, field] of Object.entries(table.fields)) {
      const type = enumColumnType(field);
      if (type !== undefined) overrides[`${table.name}.${column}`] = type;
    }
  }
  return overrides;
}
