import fs from "node:fs";
import path from "node:path";
import { measure } from "@/performance";
import { TailorDBType } from "./schema";
import { TailorDBServiceConfig } from "./types";

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

  async loadTypesForFile(typeFile: string) {
    this.types[typeFile] = {};
    try {
      const module = await import(`${typeFile}?t=${Date.now()}`);

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

          return {
            Name: metadata.name || type.name,
            Description: schema?.description || "",
            Fields: fields,
            Relationships: {},
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
