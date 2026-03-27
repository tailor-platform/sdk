import { findPattern, transformFile } from "../../codemod-engine";
import type { MigrationRule } from "../../types";

export const defineGeneratorsRule: MigrationRule = {
  id: "v2/define-generators",
  name: "Rename defineGenerators to definePlugins",
  description:
    "Renames the deprecated defineGenerators() function to definePlugins(). " +
    "defineGenerators was deprecated in v1.30.0 and removed in v2.0.0.",
  since: "1.0.0",
  until: "2.0.0",
  async transform(ctx) {
    const filesModified: string[] = [];
    const warnings: string[] = [];

    for (const file of ctx.files) {
      const changed = await transformFile(
        file,
        (source) => {
          const matches = findPattern(source, "defineGenerators");
          if (matches.length === 0) return null;
          return source.replaceAll("defineGenerators", "definePlugins");
        },
        ctx.dryRun,
      );
      if (changed) filesModified.push(file);
    }

    return { changed: filesModified.length > 0, filesModified, warnings };
  },
};
