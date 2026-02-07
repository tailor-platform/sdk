/**
 * Change History - On Create Executor
 *
 * Records creation history when a record is created.
 */

import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";
import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { Kysely } from "kysely";
import { withPluginContext, type PluginDBSchema, type PluginRecord } from "@/plugin/with-context";
import type { ChangeHistoryContext } from "../types";

export default withPluginContext<ChangeHistoryContext>((ctx) =>
  createExecutor({
    name: `${ctx.sourceType.name.toLowerCase()}-history-on-create`,
    description: `Records creation history for ${ctx.sourceType.name}`,
    // Type assertion needed: TailorAnyDBType is compatible but TypeScript can't infer it
    trigger: recordCreatedTrigger({
      type: ctx.sourceType as Parameters<typeof recordCreatedTrigger>[0]["type"],
    }),
    operation: {
      kind: "function",
      body: async (args) => {
        const db = new Kysely<PluginDBSchema>({
          dialect: new TailordbDialect(new tailordb.Client({ namespace: ctx.namespace })),
        });
        const newRecord = args.newRecord as PluginRecord;
        await db
          .insertInto(ctx.historyType.name)
          .values({
            recordId: newRecord.id,
            action: "CREATE",
            performedBy: args.actor?.userId ?? null,
            performedAt: new Date().toISOString(),
            previousValues: null,
            newValues: JSON.stringify(newRecord),
            changedFields: JSON.stringify(Object.keys(newRecord)),
          })
          .execute();
      },
    },
  }),
);
