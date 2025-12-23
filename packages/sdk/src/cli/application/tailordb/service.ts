import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { logger, styles } from "@/cli/utils/logger";
import { type TailorDBType } from "@/configure/services/tailordb/schema";
import {
  parseTailorDBType,
  buildBackwardRelationships,
} from "@/parser/service/tailordb";
import type { TailorDBServiceConfig } from "@/configure/services/tailordb/types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb";

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
      this.types[typeName] = parseTailorDBType(type);
    }

    buildBackwardRelationships(this.types);
  }
}
