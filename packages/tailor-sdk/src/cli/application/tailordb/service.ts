import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as inflection from "inflection";
import { type TailorDBType } from "@/configure/services/tailordb/schema";
import { type TailorDBServiceConfig } from "@/configure/services/tailordb/types";
import type {
  ParsedTailorDBType,
  ParsedField,
  ParsedRelationship,
} from "@/parser/service/tailordb/types";

export class TailorDBService {
  private rawTypes: Record<string, Record<string, TailorDBType>> = {};
  private types: Record<string, ParsedTailorDBType> = {};
  private typeSourceInfo: Record<
    string,
    { filePath: string; exportName: string }
  > = {};

  constructor(
    public readonly namespace: string,
    public readonly config: TailorDBServiceConfig,
  ) {}

  getTypes() {
    return this.types as Readonly<typeof this.types>;
  }

  getTypeSourceInfo() {
    return this.typeSourceInfo as Readonly<typeof this.typeSourceInfo>;
  }

  async loadTypes() {
    if (Object.keys(this.rawTypes).length > 0) {
      return this.rawTypes;
    }

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
    this.parseTypes();
    return this.types;
  }

  async loadTypesForFile(typeFile: string, timestamp?: Date) {
    this.rawTypes[typeFile] = {};
    try {
      const baseUrl = pathToFileURL(typeFile).href;
      const moduleSpecifier =
        timestamp === undefined
          ? baseUrl
          : `${baseUrl}?t=${timestamp.getTime()}`;

      const module = await import(moduleSpecifier);

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
          this.rawTypes[typeFile][exportedValue.name] = exportedValue;
          // Store source info mapping
          this.typeSourceInfo[exportedValue.name] = {
            filePath: typeFile,
            exportName,
          };
        }
      }
    } catch (error) {
      console.error(`Failed to load type from ${typeFile}:`, error);
      throw error;
    }
    this.parseTypes();
    return this.rawTypes[typeFile];
  }

  private parseTypes() {
    const allTypes: Record<string, TailorDBType> = {};
    for (const fileTypes of Object.values(this.rawTypes)) {
      for (const [typeName, type] of Object.entries(fileTypes)) {
        allTypes[typeName] = type;
      }
    }

    this.types = {};
    for (const [typeName, type] of Object.entries(allTypes)) {
      this.types[typeName] = this.parseTailorDBType(type);
    }

    this.buildBackwardRelationships(this.types);
  }

  private parseTailorDBType(type: TailorDBType): ParsedTailorDBType {
    const metadata = type.metadata;
    const schema = metadata.schema;

    const pluralForm =
      schema?.settings?.pluralForm || inflection.pluralize(type.name);

    const fields: Record<string, ParsedField> = {};
    const forwardRelationships: Record<string, ParsedRelationship> = {};

    for (const [fieldName, fieldDef] of Object.entries(type.fields)) {
      const fieldConfig = schema.fields?.[fieldName];
      if (!fieldConfig) continue;

      const parsedField: ParsedField = { name: fieldName, config: fieldConfig };

      const ref = (fieldDef as any).reference;
      if (ref) {
        const targetType = ref.type?.name;
        if (targetType) {
          const forwardName =
            ref.nameMap?.[0] || inflection.camelize(targetType, true);
          const backwardName = ref.nameMap?.[1] || "";
          const key = ref.key || "id";
          const unique = (fieldDef as any).metadata?.unique ?? false;

          parsedField.relation = {
            targetType,
            forwardName,
            backwardName,
            key,
            unique,
          };

          forwardRelationships[forwardName] = {
            name: forwardName,
            targetType,
            targetField: fieldName,
            sourceField: key,
            isArray: false,
            description: ref.type?.metadata?.description || "",
          };
        }
      }

      fields[fieldName] = parsedField;
    }

    return {
      name: type.name,
      pluralForm,
      description: schema?.description,
      fields,
      forwardRelationships,
      backwardRelationships: {},
      settings: schema?.settings || {},
      permissions: schema?.permissions || {},
      indexes: schema?.indexes,
      files: schema?.files,
    };
  }

  private buildBackwardRelationships(
    types: Record<string, ParsedTailorDBType>,
  ): void {
    for (const [typeName, type] of Object.entries(types)) {
      for (const [otherTypeName, otherType] of Object.entries(types)) {
        for (const [fieldName, field] of Object.entries(otherType.fields)) {
          if (field.relation && field.relation.targetType === typeName) {
            let backwardName = field.relation.backwardName;

            if (!backwardName) {
              const lowerName = inflection.camelize(otherTypeName, true);
              backwardName = field.relation.unique
                ? inflection.singularize(lowerName)
                : inflection.pluralize(lowerName);
            }

            type.backwardRelationships[backwardName] = {
              name: backwardName,
              targetType: otherTypeName,
              targetField: fieldName,
              sourceField: field.relation.key,
              isArray: !field.relation.unique,
              description: otherType.description || "",
            };
          }
        }
      }
    }
  }
}
