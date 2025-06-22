/* eslint-disable @typescript-eslint/no-explicit-any */

import fs from "node:fs";
import path from "node:path";
import { measure } from "../../performance";
import { TailorDBType } from "./schema";
import { TailorDBServiceConfig } from "./types";

export class TailorDBService {
  private types: TailorDBType<any, any>[] = [];

  constructor(
    public readonly namespace: string,
    public readonly config: TailorDBServiceConfig,
  ) {}

  @measure
  getTypes() {
    return this.types;
  }

  @measure
  async apply() {
    if (this.config.files && this.config.files.length > 0) {
      await this.loadTypes();
    }
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
      Types: this.types.map((type) => {
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
                Validate: fieldConfig.validate || [],
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
      }),
      Version: "v2",
    };
  }

  @measure
  private async loadTypes(): Promise<void> {
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
      try {
        const module = await import(typeFile);

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
            console.log(`Adding type "${exportName}" from ${typeFile}`);
            this.types.push(exportedValue);
          }
        }
      } catch (error) {
        console.error(`Failed to load type from ${typeFile}:`, error);
      }
    }
  }
}
