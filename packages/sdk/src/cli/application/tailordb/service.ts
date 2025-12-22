import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as inflection from "inflection";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { logger, styles } from "@/cli/utils/logger";
import {
  type TailorDBType,
  type TailorDBField,
} from "@/configure/services/tailordb/schema";
import {
  parseFieldConfig,
  ensureNoExternalVariablesInFieldScripts,
} from "@/parser/service/tailordb";
import type { TailorDBServiceConfig } from "@/configure/services/tailordb/types";
import type {
  ParsedTailorDBType,
  ParsedField,
  ParsedRelationship,
} from "@/parser/service/tailordb";

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

    const typeFiles = loadFilesWithIgnores(this.config);

    logger.newline();
    logger.log(
      `Found ${styles.highlight(typeFiles.length.toString())} type files for TailorDB service ${styles.highlight(`"${this.namespace}"`)}`,
    );

    await Promise.all(typeFiles.map((typeFile) => this.loadTypeFile(typeFile)));
    this.parseTypes();
    return this.types;
  }

  async loadTypesForFile(typeFile: string) {
    const result = await this.loadTypeFile(typeFile);
    this.parseTypes();
    return result;
  }

  private async loadTypeFile(typeFile: string) {
    this.rawTypes[typeFile] = {};
    const loadedTypes: Record<string, TailorDBType> = {};
    try {
      const module = await import(pathToFileURL(typeFile).href);

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
          const relativePath = path.relative(process.cwd(), typeFile);
          logger.log(
            `Type: ${styles.successBright(`"${exportName}"`)} loaded from ${styles.path(relativePath)}`,
          );
          this.rawTypes[typeFile][exportedValue.name] = exportedValue;
          loadedTypes[exportedValue.name] = exportedValue;
          // Store source info mapping
          this.typeSourceInfo[exportedValue.name] = {
            filePath: typeFile,
            exportName,
          };
        }
      }
    } catch (error) {
      const relativePath = path.relative(process.cwd(), typeFile);
      logger.error(
        `${styles.error("Failed to load type from")} ${styles.errorBright(relativePath)}`,
      );
      logger.error(String(error));
      throw error;
    }
    return loadedTypes;
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

    const pluralForm =
      metadata.settings?.pluralForm || inflection.pluralize(type.name);

    const fields: Record<string, ParsedField> = {};
    const forwardRelationships: Record<string, ParsedRelationship> = {};

    for (const [fieldName, fieldDef] of Object.entries(type.fields) as [
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TailorDBField requires generic type parameters
      TailorDBField<any, any>,
    ][]) {
      // Use parser function to convert field metadata to config
      const fieldConfig = parseFieldConfig(fieldDef);

      ensureNoExternalVariablesInFieldScripts(
        type.name,
        fieldName,
        fieldConfig,
      );

      const parsedField: ParsedField = { name: fieldName, config: fieldConfig };

      const ref = fieldDef.reference;
      if (ref) {
        const targetType = ref.type?.name;
        if (targetType) {
          const forwardName =
            ref.nameMap?.[0] || inflection.camelize(targetType, true);
          const backwardName = ref.nameMap?.[1] || "";
          const key = ref.key || "id";
          const unique = fieldDef.metadata?.unique ?? false;

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
      description: metadata.description,
      fields,
      forwardRelationships,
      backwardRelationships: {},
      settings: metadata.settings || {},
      permissions: metadata.permissions || {},
      indexes: metadata.indexes,
      files: metadata.files,
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
