/**
 * Change History - On Update Executor
 *
 * Records update history when a record is updated.
 *
 * Note: This file is a template that will be bundled in user projects.
 * Type checking is intentionally relaxed as types are resolved at bundle time.
 */

import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";
import { createExecutor, recordUpdatedTrigger } from "@tailor-platform/sdk";
import { Kysely } from "kysely";
import { withPluginContext } from "@/plugin/with-context";
import type { ChangeHistoryContext } from "../types";

export default withPluginContext<ChangeHistoryContext>((ctx) =>
  createExecutor({
    name: `${ctx.sourceType.name.toLowerCase()}-history-on-update`,
    description: `Records update history for ${ctx.sourceType.name}`,
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    trigger: recordUpdatedTrigger({ type: ctx.sourceType as any }),
    operation: {
      kind: "function",
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      body: async (args: any) => {
        const oldRecord = args.oldRecord;
        const newRecord = args.newRecord;

        // Calculate changed fields
        const changedFields: string[] = [];
        for (const key of Object.keys(newRecord)) {
          if (JSON.stringify(newRecord[key]) !== JSON.stringify(oldRecord[key])) {
            changedFields.push(key);
          }
        }

        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
        const db = new Kysely<any>({
          // oxlint-disable-next-line @typescript-eslint/no-explicit-any
          dialect: new TailordbDialect(args.tailordb[ctx.namespace]) as any,
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
