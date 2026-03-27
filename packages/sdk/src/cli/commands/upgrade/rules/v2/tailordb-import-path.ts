import { transformFile } from "../../codemod-engine";
import type { MigrationRule } from "../../types";

const oldImportPath = "@tailor-platform/sdk/tailordb";
const newImportPath = "@tailor-platform/sdk/schema";

export const tailordbImportPathRule: MigrationRule = {
  id: "v2/tailordb-import-path",
  name: "Rename @tailor-platform/sdk/tailordb import path",
  description:
    "Renames the import path @tailor-platform/sdk/tailordb to @tailor-platform/sdk/schema. " +
    "The tailordb subpath was renamed for consistency in v2.0.0.",
  since: "1.0.0",
  until: "2.0.0",
  async transform(ctx) {
    const filesModified: string[] = [];
    const warnings: string[] = [];

    for (const file of ctx.files) {
      const changed = await transformFile(
        file,
        (source) => {
          if (!source.includes(oldImportPath)) return null;
          return source.replaceAll(oldImportPath, newImportPath);
        },
        ctx.dryRun,
      );
      if (changed) filesModified.push(file);
    }

    return { changed: filesModified.length > 0, filesModified, warnings };
  },
};
