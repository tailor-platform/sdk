import { batchRename } from "../../codemod-engine";
import { createRule } from "../../rule-helpers";

const triggerRenames = new Map([
  ["recordCreatedTrigger", "onRecordCreated"],
  ["recordUpdatedTrigger", "onRecordUpdated"],
  ["recordDeletedTrigger", "onRecordDeleted"],
  ["resolverExecutedTrigger", "onResolverExecuted"],
  ["scheduleTrigger", "onSchedule"],
  ["incomingWebhookTrigger", "onWebhook"],
]);

export const renameExecutorTriggersRule = createRule(
  {
    id: "v2/rename-executor-triggers",
    name: "Rename executor trigger functions",
    description:
      "Renames executor trigger functions to the on* naming convention " +
      "(e.g. recordCreatedTrigger -> onRecordCreated, scheduleTrigger -> onSchedule).",
    since: "1.0.0",
    until: "2.0.0",
  },
  (source) => {
    const { output, count } = batchRename(source, triggerRenames);
    return count > 0 ? output : null;
  },
);
