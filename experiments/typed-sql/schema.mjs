import { POSTGRES_DIALECT_VERSION } from "@typed-sql/postgres";
import { parseSchemaSnapshot, serializeSchemaSnapshot } from "@typed-sql/schema";
import { db } from "../../packages/sdk/src/configure/services/tailordb/index.ts";
import { stripTailorDBTypeBuilderHelpers } from "../../packages/sdk/src/parser/service/tailordb/builder-helpers.ts";
import { TailorDBTypeSchema } from "../../packages/sdk/src/parser/service/tailordb/schema.ts";
import { parseTypes } from "../../packages/sdk/src/parser/service/tailordb/type-parser.ts";
import {
  COLUMN_TYPE_ALIASES,
  mapFieldTypeToColumnType,
} from "../../packages/sdk/src/utils/field-column-type.ts";

export const typePolicy = {
  bigint: "number",
  numeric: "string",
  date: "Date",
  json: "unknown",
  enums: "string-union",
  unknown: "unknown",
};

export const account = db.table("Account", {
  email: db.string(),
  nickname: db.string({ optional: true }),
  age: db.int(),
  active: db.bool(),
  score: db.float(),
  balance: db.decimal(),
  birthday: db.date({ optional: true }),
  createdAt: db.datetime(),
  role: db.enum(["ADMIN", "MEMBER"]),
});

export const project = db.table("Project", {
  ownerId: db.uuid(),
  title: db.string(),
  budget: db.decimal(),
});

export function parseTables(definitions, namespace) {
  const rawTypes = Object.fromEntries(
    definitions.map((table) => [
      table.name,
      TailorDBTypeSchema.parse(stripTailorDBTypeBuilderHelpers(table)),
    ]),
  );
  return parseTypes(rawTypes, namespace);
}

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

export function snapshotFromTables(tables) {
  const enums = {};
  const mappedTables = {};
  for (const table of Object.values(tables)) {
    const columns = {};
    for (const [name, { config }] of Object.entries(table.fields)) {
      if (config.array || config.type === "nested") {
        throw new Error(`PoC does not support ${table.name}.${name}: arrays/nested fields`);
      }
      let databaseType = databaseTypes[config.type];
      let tsType;
      if (config.type === "enum") {
        databaseType = `poc_enum_${Object.keys(enums).length}`;
        const values = config.allowedValues.map((value) => value.value);
        enums[databaseType] = values;
        tsType = values.map((value) => JSON.stringify(value)).join(" | ");
      } else {
        if (!databaseType) throw new Error(`Unsupported field type: ${config.type}`);
        const columnType = mapFieldTypeToColumnType(config.type);
        tsType = COLUMN_TYPE_ALIASES.get(columnType)?.select ?? columnType;
      }
      columns[name] = { name, databaseType, tsType, nullable: config.required !== true };
    }
    mappedTables[table.name] = { name: table.name, columns };
  }
  return parseSchemaSnapshot({
    formatVersion: 1,
    dialect: "postgres",
    dialectVersion: POSTGRES_DIALECT_VERSION,
    tables: mappedTables,
    enums,
  });
}

export function typedSqlPocPlugin() {
  return {
    id: "typed-sql-poc",
    onTailorDBReady(ctx) {
      return {
        files: ctx.tailordb.map(({ namespace, tables }) => ({
          path: `${namespace}.schema.json`,
          content: serializeSchemaSnapshot(snapshotFromTables(tables)),
        })),
      };
    },
  };
}
