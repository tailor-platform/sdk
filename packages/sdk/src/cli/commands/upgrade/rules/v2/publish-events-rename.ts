import { transformFile } from "../../codemod-engine";
import type { MigrationRule } from "../../types";

export const publishEventsRenameRule: MigrationRule = {
  id: "v2/publish-events-rename",
  name: "Rename publishEvents to emitEvents",
  description: "Renames the publishEvents property in createResolver() config to emitEvents.",
  since: "1.0.0",
  until: "2.0.0",
  async transform(ctx) {
    const filesModified: string[] = [];
    const warnings: string[] = [];

    for (const file of ctx.files) {
      const changed = await transformFile(
        file,
        (source) => {
          if (!source.includes("publishEvents")) return null;
          return source.replaceAll("publishEvents", "emitEvents");
        },
        ctx.dryRun,
      );
      if (changed) filesModified.push(file);
    }

    return { changed: filesModified.length > 0, filesModified, warnings };
  },
};
