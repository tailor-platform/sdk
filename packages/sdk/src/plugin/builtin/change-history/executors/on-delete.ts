/**
 * Change History - On Delete Executor
 *
 * Records deletion history when a record is deleted.
 *
 * Note: This file is a template that will be bundled in user projects.
 * Type checking is intentionally relaxed as types are resolved at bundle time.
 */

import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";
import { createExecutor, recordDeletedTrigger } from "@tailor-platform/sdk";
import { Kysely } from "kysely";
import { withPluginContext } from "@/plugin/with-context";
import type { ChangeHistoryContext } from "../types";

export default withPluginContext<ChangeHistoryContext>((ctx) =>
  createExecutor({
    name: `${ctx.sourceType.name.toLowerCase()}-history-on-delete`,
    description: `Records deletion history for ${ctx.sourceType.name}`,
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    trigger: recordDeletedTrigger({ type: ctx.sourceType as any }),
    operation: {
      kind: "function",
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      body: async (args: any) => {
        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
        const db = new Kysely<any>({
          // oxlint-disable-next-line @typescript-eslint/no-explicit-any
          dialect: new TailordbDialect(args.tailordb[ctx.namespace]) as any,
        });
        const oldRecord = args.oldRecord;
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
