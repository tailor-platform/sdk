/**
 * Change History - On Create Executor
 *
 * Records creation history when a record is created.
 *
 * Note: This file is a template that will be bundled in user projects.
 * Type checking is intentionally relaxed as types are resolved at bundle time.
 */

import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";
import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { Kysely } from "kysely";
import { withPluginContext } from "@/plugin/with-context";
import type { ChangeHistoryContext } from "../types";

export default withPluginContext<ChangeHistoryContext>((ctx) =>
  createExecutor({
    name: `${ctx.sourceType.name.toLowerCase()}-history-on-create`,
    description: `Records creation history for ${ctx.sourceType.name}`,
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    trigger: recordCreatedTrigger({ type: ctx.sourceType as any }),
    operation: {
      kind: "function",
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      body: async (args: any) => {
        // oxlint-disable-next-line @typescript-eslint/no-explicit-any
        const db = new Kysely<any>({
          // oxlint-disable-next-line @typescript-eslint/no-explicit-any
          dialect: new TailordbDialect(args.tailordb[ctx.namespace]) as any,
        });
        const newRecord = args.newRecord;
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
