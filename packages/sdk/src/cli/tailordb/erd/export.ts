import * as fs from "node:fs";
import * as path from "node:path";
import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "citty";
import { commonArgs, deploymentArgs, jsonArgs, withCommonArgs } from "../../args";
import { fetchAll, initOperatorClient } from "../../client";
import { loadConfig } from "../../config-loader";
import { loadAccessToken, loadWorkspaceId } from "../../context";
import { logger } from "../../utils/logger";
import type {
  TailorDBType as TailorDBProtoType,
  TailorDBType_FieldConfig,
  TailorDBType_Value,
} from "@tailor-proto/tailor/v1/tailordb_resource_pb";

export interface TailorDBSchemaOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
  namespace?: string;
}

interface TblsColumn {
  name: string;
  type: string;
  nullable: boolean;
  comment: string;
}

interface TblsTable {
  name: string;
  type: string;
  comment: string;
  columns: TblsColumn[];
  indexes: unknown[];
  constraints: TblsConstraint[];
  triggers: unknown[];
  def: string;
  referenced_tables: string[];
}

interface TblsRelation {
  table: string;
  columns: string[];
  parent_table: string;
  parent_columns: string[];
  cardinality: "zero_or_one" | "exactly_one" | "zero_or_more" | "one_or_more";
  parent_cardinality: "zero_or_one" | "exactly_one" | "zero_or_more" | "one_or_more";
  def: string;
}

interface TblsConstraint {
  name: string;
  type: "PRIMARY KEY" | "FOREIGN KEY" | string;
  def: string;
  table: string;
  columns: string[];
  referenced_table?: string;
  referenced_columns?: string[];
}

interface TblsEnum {
  name: string;
  values: string[];
}

interface TblsSchema {
  name: string;
  tables: TblsTable[];
  relations: TblsRelation[];
  enums: TblsEnum[];
}

async function getAllNamespaces(configPath?: string): Promise<string[]> {
  const { config } = await loadConfig(configPath);
  const namespaces = new Set<string>();

  if (config.db) {
    for (const [namespaceName] of Object.entries(config.db)) {
      namespaces.add(namespaceName);
    }
  }

  return Array.from(namespaces);
}

async function resolveNamespace(configPath?: string, explicitNamespace?: string): Promise<string> {
  if (explicitNamespace) {
    return explicitNamespace;
  }

  const namespaces = await getAllNamespaces(configPath);

  if (namespaces.length === 0) {
    throw new Error(
      "No TailorDB namespaces found in config. Please define db services in tailor.config.ts or pass --namespace.",
    );
  }

  if (namespaces.length > 1) {
    throw new Error(
      `Multiple TailorDB namespaces found in config: ${namespaces.join(
        ", ",
      )}. Please specify one using --namespace.`,
    );
  }

  return namespaces[0]!;
}

/**
 * Convert TailorDB field config to tbls column definition.
 * @param {string} fieldName - Field name
 * @param {TailorDBType_FieldConfig} fieldConfig - TailorDB field configuration
 * @returns {TblsColumn} tbls column definition
 */
function toTblsColumn(fieldName: string, fieldConfig: TailorDBType_FieldConfig): TblsColumn {
  const baseType = fieldConfig.type || "string";
  const type = fieldConfig.array ? `${baseType}[]` : baseType;

  return {
    name: fieldName,
    type,
    nullable: !fieldConfig.required,
    comment: fieldConfig.description ?? "",
  };
}

/**
 * Build tbls schema JSON from TailorDB types.
 * @param {TailorDBProtoType[]} types - TailorDB types fetched from platform
 * @param {string} namespace - TailorDB namespace
 * @returns {TblsSchema} tbls-compatible schema representation
 */
function buildTblsSchema(types: TailorDBProtoType[], namespace: string): TblsSchema {
  const tables: TblsTable[] = [];
  const relations: TblsRelation[] = [];
  const referencedByTable: Record<string, Set<string>> = {};
  const constraintsByTable: Record<string, TblsConstraint[]> = {};
  const enumsMap: Map<string, Set<string>> = new Map();

  for (const type of types) {
    const tableName = type.name;
    const schema = type.schema;

    const columns: TblsColumn[] = [];
    const tableConstraints: TblsConstraint[] = [];

    // Implicit primary key column
    columns.push({
      name: "id",
      type: "uuid",
      nullable: false,
      comment: "",
    });

    tableConstraints.push({
      name: `pk_${tableName}`,
      type: "PRIMARY KEY",
      def: "",
      table: tableName,
      columns: ["id"],
    });

    if (schema) {
      // Fields -> columns
      for (const [fieldName, fieldConfig] of Object.entries(schema.fields ?? {})) {
        columns.push(toTblsColumn(fieldName, fieldConfig));

        // Collect enum values
        if (fieldConfig.type === "enum" && fieldConfig.allowedValues.length > 0) {
          const enumName = `${tableName}_${fieldName}`;
          let values = enumsMap.get(enumName);
          if (!values) {
            values = new Set<string>();
            enumsMap.set(enumName, values);
          }
          for (const value of fieldConfig.allowedValues as TailorDBType_Value[]) {
            values.add(value.value);
          }
        }

        // Foreign key -> relation + constraint
        if (fieldConfig.foreignKey && fieldConfig.foreignKeyType) {
          const foreignTable = fieldConfig.foreignKeyType;
          const foreignColumn = fieldConfig.foreignKeyField || "id";

          // Cardinality:
          // - child side: exactly_one if non-nullable, zero_or_one if nullable FK
          // - parent side: zero_or_more (a parent can have many children)
          const childCardinality = fieldConfig.required ? "exactly_one" : "zero_or_one";
          const parentCardinality = "zero_or_more";

          // tbls RelationJSON:
          // - table/columns: child side (FK owner)
          // - parent_table/parent_columns: referenced side
          relations.push({
            table: tableName,
            columns: [fieldName],
            parent_table: foreignTable,
            parent_columns: [foreignColumn],
            cardinality: childCardinality,
            parent_cardinality: parentCardinality,
            def: "",
          });

          tableConstraints.push({
            name: `fk_${tableName}_${fieldName}`,
            type: "FOREIGN KEY",
            def: "",
            table: tableName,
            columns: [fieldName],
            referenced_table: foreignTable,
            referenced_columns: [foreignColumn],
          });

          if (!referencedByTable[tableName]) {
            referencedByTable[tableName] = new Set<string>();
          }
          referencedByTable[tableName].add(foreignTable);
        }
      }
    }

    constraintsByTable[tableName] = tableConstraints;

    tables.push({
      name: tableName,
      type: "table",
      comment: schema?.description ?? "",
      columns,
      indexes: [],
      constraints: constraintsByTable[tableName] ?? [],
      triggers: [],
      def: "",
      referenced_tables: [],
    });
  }

  // Populate referenced_tables from collected relations
  for (const table of tables) {
    const referenced = referencedByTable[table.name];
    table.referenced_tables = referenced ? Array.from(referenced) : [];
  }

  const enums: TblsEnum[] = [];
  for (const [name, values] of enumsMap.entries()) {
    enums.push({
      name,
      values: Array.from(values),
    });
  }

  return {
    name: namespace,
    tables,
    relations,
    enums,
  };
}

/**
 * Export apply-applied TailorDB schema for a namespace as tbls-compatible JSON.
 * @param {TailorDBSchemaOptions} options - Export options
 * @returns {Promise<TblsSchema>} tbls schema representation
 */
export async function exportTailorDBSchema(options: TailorDBSchemaOptions): Promise<TblsSchema> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  const namespace = await resolveNamespace(options.configPath, options.namespace);

  const types = await fetchAll(async (pageToken) => {
    try {
      const { tailordbTypes, nextPageToken } = await client.listTailorDBTypes({
        workspaceId,
        namespaceName: namespace,
        pageToken,
      });
      return [tailordbTypes, nextPageToken];
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return [[], ""];
      }
      throw error;
    }
  });

  if (types.length === 0) {
    logger.warn(
      `No TailorDB types found in namespace "${options.namespace}". Returning empty schema.`,
    );
  }

  return buildTblsSchema(types, namespace);
}

interface WriteSchemaOptions extends TailorDBSchemaOptions {
  outputPath: string;
  printJson: boolean;
}

async function writeTblsSchemaToFile(options: WriteSchemaOptions): Promise<void> {
  const schema = await exportTailorDBSchema(options);
  const json = JSON.stringify(schema, null, 2);

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, json, "utf8");

  const relativePath = path.relative(process.cwd(), options.outputPath);
  logger.success(`Wrote ERD schema to ${relativePath}`);

  if (options.printJson) {
    logger.out(schema);
  }
}

export const erdExportCommand = defineCommand({
  meta: {
    name: "export",
    description: "Export applied TailorDB schema as tbls-compatible JSON for ERD tools",
  },
  args: {
    ...commonArgs,
    ...deploymentArgs,
    ...jsonArgs,
    namespace: {
      type: "string",
      description: "TailorDB namespace name (optional if only one namespace is defined in config)",
      alias: "n",
    },
    output: {
      type: "string",
      description: "Output file path for tbls-compatible ERD JSON",
      alias: "o",
      default: "schema.json",
    },
  },
  run: withCommonArgs(async (args) => {
    const outputPath = path.resolve(process.cwd(), String(args.output));

    await writeTblsSchemaToFile({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      namespace: args.namespace,
      outputPath,
      printJson: Boolean(args.json),
    });
  }),
});
