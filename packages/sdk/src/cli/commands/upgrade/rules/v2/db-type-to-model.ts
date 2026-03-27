import { applyPatternReplace, transformFile } from "../../codemod-engine";
import type { MigrationRule } from "../../types";

export const dbTypeToModelRule: MigrationRule = {
  id: "v2/db-type-to-model",
  name: "Rename db.type() to db.model()",
  description:
    "Renames the db.type() method to db.model() in TailorDB type definitions. " +
    "The method was renamed for clarity in v2.0.0.",
  since: "1.0.0",
  until: "2.0.0",
  async transform(ctx) {
    const filesModified: string[] = [];
    const warnings: string[] = [];

    for (const file of ctx.files) {
      const changed = await transformFile(
        file,
        (source) => {
          const result = applyPatternReplace(source, "$DB.type($$$ARGS)", (node) => {
            const db = node.getMatch("DB")!.text();
            // Only transform when the receiver is "db" to avoid false positives
            if (db !== "db") return node.text();
            const args = node
              .getMultipleMatches("ARGS")
              .filter((n) => n.kind() !== ",")
              .map((n) => n.text());
            return `${db}.model(${args.join(", ")})`;
          });
          return result.count > 0 ? result.output : null;
        },
        ctx.dryRun,
      );
      if (changed) filesModified.push(file);
    }

    return { changed: filesModified.length > 0, filesModified, warnings };
  },
};
