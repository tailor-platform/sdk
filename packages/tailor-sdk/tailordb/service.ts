import fs from "node:fs";
import path from "node:path";
import { TailorDBServiceConfig } from "./types";
import { measure } from "../performance";
import { isDBType } from "./schema";

export class TailorDBService {
  private types: any[] = [];

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

          if (isDBType(exportedValue)) {
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
