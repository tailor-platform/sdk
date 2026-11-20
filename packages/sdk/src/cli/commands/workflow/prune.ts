import { arg } from "@politty/zod";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { pruneHint, reclaimWorkflowRuns } from "#/cli/shared/workflow-run";

export const pruneCommand = defineAppCommand({
  name: "prune",
  description: "Remove the temporary resources that `workflow run` left behind.",
  args: z.strictObject({
    ...workspaceArgs,
    "include-unlabeled": arg(z.boolean().default(false), {
      description:
        "Also remove resources named `tmp-run-…` that carry no `workflow run` label (a run that was cut off before it labeled them)",
    }),
  }),
  notes: `Removes the workflow, job functions and functions of every \`workflow run\` that has finished, at once. A run that is still executing is left alone.

A resource whose name starts with \`tmp-run-\` but that carries no \`workflow run\` label is reported and left in place, because the name alone does not prove \`workflow run\` created it. When it is a leftover of an interrupted run, \`--include-unlabeled\` removes it.`,
  examples: [
    { cmd: "", desc: "Remove the resources of finished runs" },
    {
      cmd: "--include-unlabeled",
      desc: "Also remove `tmp-run-…` resources that have no label",
    },
  ],
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const { client, workspaceId } = await loadOperatorWorkspaceContext({
      profile: args.profile,
      workspaceId: args["workspace-id"],
    });
    const result = await reclaimWorkflowRuns({
      client,
      workspaceId,
      now: new Date(),
      ignoreFinishedGrace: true,
      includeUnlabeled: args["include-unlabeled"],
    });

    if (logger.jsonMode) {
      logger.out({
        removed: result.removed,
        unlabeled: { kept: result.keptUnlabeled, removed: result.removedUnlabeled },
      });
      return;
    }
    logger.success(`Removed ${result.removed.length} finished run(s).`);
    if (result.removedUnlabeled.length > 0) {
      logger.success(`Removed ${result.removedUnlabeled.length} unlabeled resource(s):`);
      for (const { kind, name } of result.removedUnlabeled) {
        logger.log(`  ${kind} ${name}`);
      }
    }
    if (result.keptUnlabeled.length > 0) {
      logger.warn(
        `Left ${result.keptUnlabeled.length} resource(s) named \`tmp-run-…\` that carry no \`workflow run\` label, ` +
          "so they may not belong to `workflow run`:",
      );
      for (const { kind, name } of result.keptUnlabeled) {
        logger.log(`  ${kind} ${name}`);
      }
      logger.log(
        `If they are leftovers of an interrupted run, ${pruneHint({ workspaceId, profile: args.profile, includeUnlabeled: true })} removes them.`,
      );
    }
  },
});
