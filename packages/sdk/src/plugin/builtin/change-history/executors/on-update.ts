/**
 * Change History - On Update Executor
 *
 * Records update history when a record is updated.
 */

import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";
import { createExecutor, recordUpdatedTrigger } from "@tailor-platform/sdk";
import { Kysely } from "kysely";
import { withPluginContext, type PluginDBSchema, type PluginRecord } from "@/plugin/with-context";
import type { ChangeHistoryContext } from "../types";

export default withPluginContext<ChangeHistoryContext>((ctx) =>
  createExecutor({
    name: `${ctx.sourceType.name.toLowerCase()}-history-on-update`,
    description: `Records update history for ${ctx.sourceType.name}`,
    // Type assertion needed: TailorAnyDBType is compatible but TypeScript can't infer it
    trigger: recordUpdatedTrigger({
      type: ctx.sourceType as Parameters<typeof recordUpdatedTrigger>[0]["type"],
    }),
    operation: {
      kind: "function",
      body: async (args) => {
        const oldRecord = args.oldRecord as PluginRecord;
        const newRecord = args.newRecord as PluginRecord;

        // Calculate changed fields
        const changedFields: string[] = [];
        for (const key of Object.keys(newRecord)) {
          if (JSON.stringify(newRecord[key]) !== JSON.stringify(oldRecord[key])) {
            changedFields.push(key);
          }
        }

        const db = new Kysely<PluginDBSchema>({
          dialect: new TailordbDialect(new tailordb.Client({ namespace: ctx.namespace })),
        });
        await db
          .insertInto(ctx.historyType.name)
          .values({
            recordId: newRecord.id,
            action: "UPDATE",
            performedBy: args.actor?.userId ?? null,
            performedAt: new Date().toISOString(),
            previousValues: JSON.stringify(oldRecord),
            newValues: JSON.stringify(newRecord),
            changedFields: JSON.stringify(changedFields),
          })
          .execute();
      },
    },
  }),
);
