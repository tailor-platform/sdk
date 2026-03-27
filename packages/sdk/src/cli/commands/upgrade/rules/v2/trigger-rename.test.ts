import { describe, it } from "vitest";
import { runFixtureTest } from "../../__test_fixtures__/fixture-helper";
import { findPattern } from "../../codemod-engine";

const triggerRenames = new Map([
  ["recordCreatedTrigger", "onRecordCreated"],
  ["recordUpdatedTrigger", "onRecordUpdated"],
  ["recordDeletedTrigger", "onRecordDeleted"],
  ["resolverExecutedTrigger", "onResolverExecuted"],
  ["scheduleTrigger", "onSchedule"],
  ["incomingWebhookTrigger", "onIncomingWebhook"],
]);

describe("trigger-rename rule", () => {
  it("should rename all trigger functions to on* convention", async () => {
    await runFixtureTest("v2/trigger-rename", (source) => {
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
    });
  });
});
