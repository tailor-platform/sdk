import fs from "node:fs";
import path from "node:path";
import { TailorDBServiceConfig } from "./types";

export class TailorDBService {
  private types: any[] = [];

  constructor(public config: TailorDBServiceConfig) {
  }

  get workspace(): string {
    return this.config.namespace;
  }

  get namespace(): string {
    return this.config.namespace;
  }

  getTypes() {
    return this.types;
  }

  async apply() {
    // If files are specified, load types from those files
    if (this.config.files && this.config.files.length > 0) {
      await this.loadTypesFromFiles();
    }
  }

  private async loadTypesFromFiles(): Promise<void> {
    if (!this.config.files || this.config.files.length === 0) {
      return;
    }

    const typeFiles: string[] = [];

    // Detect files matching the patterns
    for (const pattern of this.config.files) {
      const baseDir = path.dirname(pattern);
      const filePattern = path.basename(pattern);

      // Simple glob to regex conversion (supports * wildcard)
      const regexPattern = filePattern
        .replace(/\./g, "\\.")
        .replace(/\*/g, ".*");
      const regex = new RegExp(`^${regexPattern}$`);

      // Read directory and filter files
      const absoluteBaseDir = path.resolve(process.cwd(), baseDir);
      if (fs.existsSync(absoluteBaseDir)) {
        const files = fs.readdirSync(absoluteBaseDir);
        const matchedFiles = files
          .filter((file) => regex.test(file))
          .map((file) => path.join(absoluteBaseDir, file));
        typeFiles.push(...matchedFiles);
      }
    }

    console.log(
      `Found ${typeFiles.length} type files for TailorDB service "${this.config.namespace}"`,
    );

    // Load and add types from each file
    for (const typeFile of typeFiles) {
      try {
        // Dynamic import of the type file
        const module = await import(typeFile);

        // Look for exported types (they should be TailorDBDef objects)
        for (const exportName of Object.keys(module)) {
          const exportedValue = module[exportName];

          // Check if this is a TailorDB type definition
          if (
            exportedValue && typeof exportedValue === "object" &&
            exportedValue.metadata
          ) {
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
