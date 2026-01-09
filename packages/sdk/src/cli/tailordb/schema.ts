import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "citty";
import { commonArgs, deploymentArgs, jsonArgs, withCommonArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";
import type {
  TailorDBType as TailorDBProtoType,
  TailorDBType_FieldConfig,
  TailorDBType_Value,
} from "@tailor-proto/tailor/v1/tailordb_resource_pb";

export interface TailorDBSchemaOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
  namespace: string;
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
  constraints: unknown[];
  triggers: unknown[];
  def: string;
  referenced_tables: string[];
}

interface TblsRelation {
  table: string;
  columns: string[];
  foreign_table: string;
  foreign_columns: string[];
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
  const enumsMap: Map<string, Set<string>> = new Map();

  for (const type of types) {
    const tableName = type.name;
    const schema = type.schema;

    const columns: TblsColumn[] = [];

    // Implicit primary key column
    columns.push({
      name: "id",
      type: "uuid",
      nullable: false,
      comment: "",
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

        // Foreign key -> relation
        if (fieldConfig.foreignKey && fieldConfig.foreignKeyType) {
          const foreignTable = fieldConfig.foreignKeyType;
          const foreignColumn = fieldConfig.foreignKeyField || "id";

          relations.push({
            table: tableName,
            columns: [fieldName],
            foreign_table: foreignTable,
            foreign_columns: [foreignColumn],
          });

          if (!referencedByTable[tableName]) {
            referencedByTable[tableName] = new Set<string>();
          }
          referencedByTable[tableName].add(foreignTable);
        }
      }
    }

    tables.push({
      name: tableName,
      type: "table",
      comment: schema?.description ?? "",
      columns,
      indexes: [],
      constraints: [],
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

  const types = await fetchAll(async (pageToken) => {
    try {
      const { tailordbTypes, nextPageToken } = await client.listTailorDBTypes({
        workspaceId,
        namespaceName: options.namespace,
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

  return buildTblsSchema(types, options.namespace);
}

export const schemaCommand = defineCommand({
  meta: {
    name: "schema",
    description: "Export applied TailorDB schema as tbls-compatible JSON",
  },
  args: {
    ...commonArgs,
    ...deploymentArgs,
    ...jsonArgs,
    namespace: {
      type: "string",
      description: "TailorDB namespace name",
      alias: "n",
      required: true,
    },
  },
  run: withCommonArgs(async (args) => {
    const schema = await exportTailorDBSchema({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      namespace: args.namespace,
    });

    const json = JSON.stringify(schema, null, 2);

    if (args.json) {
      // In JSON mode, write raw JSON to stdout
      // eslint-disable-next-line no-restricted-syntax
      console.log(json);
    } else {
      // When not in JSON mode, still output JSON but via logger for consistency
      logger.log(json);
    }
  }),
});
