import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { type TailorDBType } from "./schema";
import { type TailorDBServiceConfig } from "./types";

export class TailorDBService {
  private types: Record<string, Record<string, TailorDBType>> = {};

  constructor(
    public readonly namespace: string,
    public readonly config: TailorDBServiceConfig,
  ) {}

  getTypes() {
    return this.types;
  }

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
    return this.types;
  }

  async loadTypesForFile(typeFile: string, timestamp?: Date) {
    this.types[typeFile] = {};
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
          this.types[typeFile][exportedValue.name] = exportedValue;
        }
      }
    } catch (error) {
      console.error(`Failed to load type from ${typeFile}:`, error);
      throw error;
    }
    return this.types[typeFile];
  }
}
