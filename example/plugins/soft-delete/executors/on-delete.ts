/**
 * Soft Delete - On Delete Executor
 *
 * Archives records when they are deleted.
 */

import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";
import {
  createExecutor,
  recordDeletedTrigger,
  type PluginDBSchema,
  type PluginRecord,
} from "@tailor-platform/sdk";
import { withPluginContext } from "@tailor-platform/sdk/plugin";
import { Kysely } from "kysely";
import type { SoftDeleteContext } from "../types";

export default withPluginContext<SoftDeleteContext>((ctx) =>
  createExecutor({
    name: `${ctx.sourceType.name.toLowerCase()}-archive-on-delete`,
    description: `Archives ${ctx.sourceType.name} when deleted`,
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
