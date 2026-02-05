/**
 * Change History - On Delete Executor
 *
 * Records deletion history when a record is deleted.
 */

import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";
import { createExecutor, recordDeletedTrigger } from "@tailor-platform/sdk";
import { Kysely } from "kysely";
import { withPluginContext, type PluginDBSchema, type PluginRecord } from "@/plugin/with-context";
import type { ChangeHistoryContext } from "../types";

export default withPluginContext<ChangeHistoryContext>((ctx) =>
  createExecutor({
    name: `${ctx.sourceType.name.toLowerCase()}-history-on-delete`,
    description: `Records deletion history for ${ctx.sourceType.name}`,
    // Type assertion needed: TailorAnyDBType is compatible but TypeScript can't infer it
    trigger: recordDeletedTrigger({
      type: ctx.sourceType as Parameters<typeof recordDeletedTrigger>[0]["type"],
    }),
    operation: {
      kind: "function",
      body: async (args) => {
        const db = new Kysely<PluginDBSchema>({
          dialect: new TailordbDialect(new tailordb.Client({ namespace: ctx.namespace })),
        });
        const oldRecord = args.oldRecord as PluginRecord;
        await db
          .insertInto(ctx.historyType.name)
          .values({
            recordId: oldRecord.id,
            action: "DELETE",
            performedBy: args.actor?.userId ?? null,
            performedAt: new Date().toISOString(),
            previousValues: JSON.stringify(oldRecord),
            newValues: null,
            changedFields: null,
          })
          .execute();
      },
    },
  }),
);
