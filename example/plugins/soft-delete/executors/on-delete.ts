/**
 * Soft Delete - On Delete Executor
 *
 * Archives records when they are deleted.
 */

import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";
import { createExecutor, recordDeletedTrigger, withPluginContext } from "@tailor-platform/sdk";
import { Kysely } from "kysely";
import type { SoftDeleteContext } from "../types";

export default withPluginContext<SoftDeleteContext>((ctx) =>
  createExecutor({
    name: `${ctx.sourceType.name.toLowerCase()}-archive-on-delete`,
    description: `Archives ${ctx.sourceType.name} when deleted`,
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
          .insertInto(ctx.archiveType.name)
          .values({
            originalId: oldRecord.id,
            originalData: JSON.stringify(oldRecord),
            deletedAt: new Date().toISOString(),
            deletedBy: args.actor?.userId ?? null,
          })
          .execute();
      },
    },
  }),
);
