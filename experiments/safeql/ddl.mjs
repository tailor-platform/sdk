const databaseTypes = {
  uuid: "uuid",
  string: "text",
  integer: "bigint",
  float: "double precision",
  boolean: "boolean",
  decimal: "numeric",
  date: "date",
  datetime: "timestamptz",
  time: "time",
};

const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const literal = (value) => `'${value.replaceAll("'", "''")}'`;

export function ddlFromTables(tables) {
  const statements = [];
  for (const table of Object.values(tables)) {
    const columns = [];
    for (const [name, { config }] of Object.entries(table.fields)) {
      if (config.array || config.type === "nested") {
        throw new Error(`PoC does not support ${table.name}.${name}: arrays/nested fields`);
      }
      let databaseType = databaseTypes[config.type];
      if (config.type === "enum") {
        databaseType = quote(`${table.name}.${name}`);
        const values = config.allowedValues.map(({ value }) => literal(value)).join(", ");
        statements.push(`CREATE TYPE ${databaseType} AS ENUM (${values});`);
      } else if (!databaseType) {
        throw new Error(`Unsupported field type: ${config.type}`);
      }
      const constraints = [
        name === "id" ? "PRIMARY KEY" : "",
        config.required === true ? "NOT NULL" : "",
      ].filter(Boolean);
      columns.push(`  ${quote(name)} ${databaseType}${constraints.map((c) => ` ${c}`).join("")}`);
    }
    statements.push(`CREATE TABLE ${quote(table.name)} (\n${columns.join(",\n")}\n);`);
  }
  return `${statements.join("\n")}\n`;
}
