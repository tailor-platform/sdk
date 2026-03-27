import { findPattern, transformFile } from "../../codemod-engine";
import type { MigrationRule } from "../../types";

const triggerRenames: ReadonlyMap<string, string> = new Map([
  ["recordCreatedTrigger", "onRecordCreated"],
  ["recordUpdatedTrigger", "onRecordUpdated"],
  ["recordDeletedTrigger", "onRecordDeleted"],
  ["resolverExecutedTrigger", "onResolverExecuted"],
  ["scheduleTrigger", "onSchedule"],
  ["incomingWebhookTrigger", "onIncomingWebhook"],
]);

export const triggerRenameRule: MigrationRule = {
  id: "v2/trigger-rename",
  name: "Rename executor trigger functions",
  description:
    "Renames trigger factory functions to the new on* naming convention " +
    "(e.g. recordCreatedTrigger -> onRecordCreated). " +
    "Applies to both import specifiers and call sites.",
  since: "1.0.0",
  until: "2.0.0",
  async transform(ctx) {
    const filesModified: string[] = [];
    const warnings: string[] = [];

    for (const file of ctx.files) {
      const changed = await transformFile(
        file,
        (source) => {
          let result = source;
          let totalChanged = 0;

          for (const [oldName, newName] of triggerRenames) {
            const matches = findPattern(result, oldName);
            if (matches.length > 0) {
              result = result.replaceAll(oldName, newName);
              totalChanged += matches.length;
            }
          }

          return totalChanged > 0 ? result : null;
        },
        ctx.dryRun,
      );
      if (changed) filesModified.push(file);
    }

    return { changed: filesModified.length > 0, filesModified, warnings };
  },
};
