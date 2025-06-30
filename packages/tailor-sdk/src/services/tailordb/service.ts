import fs from "node:fs";
import path from "node:path";
import { measure } from "@/performance";
import { TailorDBType } from "./schema";
import { TailorDBServiceConfig } from "./types";
import inflection from "inflection";

export class TailorDBService {
  private types: Record<string, Record<string, TailorDBType>> = {};

  constructor(
    public readonly namespace: string,
    public readonly config: TailorDBServiceConfig,
  ) {}

  @measure
  getTypes() {
    return this.types;
  }

  @measure
  async loadTypes() {
    if (!this.config.files || this.config.files.length === 0) {
      return;
    }

    const typeFiles: string[] = [];
    for (const pattern of this.config.files) {
      const absolutePattern = path.resolve(process.cwd(), pattern);
      try {
        const matchedFiles = fs.globSync(absolutePattern);
        typeFiles.push(...matchedFiles);
      } catch (error) {
        console.warn(`Failed to glob pattern "${pattern}":`, error);
      }
    }

    console.log(
      `Found ${typeFiles.length} type files for TailorDB service "${this.namespace}"`,
    );

    for (const typeFile of typeFiles) {
      await this.loadTypesForFile(typeFile);
    }
    return this.types as Record<string, Record<string, TailorDBType>>;
  }

  async loadTypesForFile(typeFile: string, timestamp?: Date) {
    this.types[typeFile] = {};
    try {
      const module = await import(
        [typeFile, ...(timestamp ? [timestamp.getTime()] : [])].join("?t=")
      );

      for (const exportName of Object.keys(module)) {
        const exportedValue = module[exportName];

        const isDBTypeLike =
          exportedValue &&
          typeof exportedValue === "object" &&
          exportedValue.constructor?.name === "TailorDBType" &&
          typeof exportedValue.name === "string" &&
          typeof exportedValue.fields === "object" &&
          exportedValue.metadata &&
          typeof exportedValue.metadata === "object";

        if (isDBTypeLike) {
          console.log(`Type: "${exportName}" loaded from ${typeFile}`);
          this.types[typeFile][exportedValue.name] = exportedValue;
        }
      }
    } catch (error) {
      console.error(`Failed to load type from ${typeFile}:`, error);
    }
    return this.types[typeFile];
  }

  @measure
  toManifestJSON() {
    const defaultTypePermission = {
      Create: [
        {
          Id: "everyone",
          Ids: [],
          Permit: "allow",
        },
      ],
      Read: [
        {
          Id: "everyone",
          Ids: [],
          Permit: "allow",
        },
      ],
      Update: [
        {
          Id: "everyone",
          Ids: [],
          Permit: "allow",
        },
      ],
      Delete: [
        {
          Id: "everyone",
          Ids: [],
          Permit: "allow",
        },
      ],
      Admin: [
        {
          Id: "everyone",
          Ids: [],
          Permit: "allow",
        },
      ],
    };

    const defaultSettings = {
      Aggregation: false,
      BulkUpsert: false,
      Draft: false,
      DefaultQueryLimitSize: 100,
      MaxBulkUpsertSize: 1000,
      PluralForm: "",
      PublishRecordEvents: false,
    };

    return {
      Kind: "tailordb",
      Namespace: this.namespace,
      Types: Object.values(this.types).flatMap((types) => {
        return Object.values(types).map((type) => {
          const metadata = type.metadata;
          const schema = metadata.schema;

          // Fieldsを変換
          const fields: any = {};
          if (schema?.fields) {
            Object.entries(schema.fields)
              .filter(([fieldName]) => fieldName !== "id")
              .forEach(([fieldName, fieldConfig]: [string, any]) => {
                fields[fieldName] = {
                  Type: fieldConfig.type || "string",
                  AllowedValues: fieldConfig.allowedValues || [],
                  Description: fieldConfig.description || "",
                  Validate: (fieldConfig.validate || []).map((val: any) => ({
                    Action: "allow",
                    ErrorMessage: val.errorMessage || "",
                    Expr: val.expr || "",
                    ...(val.script && {
                      Script: {
                        Expr: val.script.expr || "",
                      },
                    }),
                  })),
                  Array: fieldConfig.array || false,
                  Index: fieldConfig.index || false,
                  Required: fieldConfig.required !== false,
                  Unique: fieldConfig.unique || false,
                  ForeignKey: fieldConfig.foreignKey || false,
                  ForeignKeyType: fieldConfig.foreignKeyType,
                  Vector: fieldConfig.vector || false,
                  ...(fieldConfig.hooks && {
                    Hooks: {
                      Create: fieldConfig.hooks?.create,
                      Update: fieldConfig.hooks?.update,
                    },
                  }),
                };
              });
          }

          // 参照しているdbTypeのrelationshipsを設定
          const relationships: Record<string, any> = {};
          // TODO: Object.entriesで型情報が失われないようにしたい。
          Object.entries(type.fields)
            .filter(([_, fieldConfig]: [string, any]) => fieldConfig.reference)
            .forEach(([fieldName, fieldConfig]: [string, any]) => {
              if (fieldConfig.reference) {
                const ref = fieldConfig.reference;
                const nameMap = ref.nameMap || [];
                if (nameMap.length > 0) {
                  relationships[nameMap[0]] = {
                    RefType: ref.type.name,
                    RefField: ref.field || "id",
                    SrcField: fieldName,
                    Array: fieldConfig._metadata?.array || false,
                    Description: ref.type.metadata.description || "",
                  };
                }
              }
            });

          // 参照されているdbTypeのrelationshipsを設定
          if (type.referenced && type.referenced.length > 0) {
            type.referenced.forEach((referencedType) => {
              // TODO: Object.entriesで型情報が失われないようにしたい。
              const [fieldName, field] = (
                Object.entries(referencedType.fields) as [string, any]
              ).find(
                ([_, fieldConfig]) =>
                  fieldConfig?._metadata?.foreignKeyType === type.name,
              );

              if (fieldName && field) {
                const nameMap = field._ref.nameMap;
                // 外部キーにunique制約がある場合は、Arrayはfalse（https://docs.tailor.tech/guides/tailordb/relationships#constraints）
                const array = !(field._metadata?.unique ?? false);
                const key = array
                  ? inflection.pluralize(nameMap[1])
                  : nameMap[1];
                relationships[key] = {
                  RefType: referencedType.name,
                  RefField: fieldName,
                  SrcField: "id",
                  Array: array,
                  Description:
                    referencedType.metadata.schema?.description || "",
                };
              }
            });
          }

          return {
            Name: metadata.name || type.name,
            Description: schema?.description || "",
            Fields: fields,
            Relationships: relationships,
            Settings: defaultSettings,
            Extends: schema?.extends || false,
            Directives: [],
            Indexes: {},
            TypePermission: defaultTypePermission,
          };
        });
      }),
      Version: "v2",
    };
  }
}
