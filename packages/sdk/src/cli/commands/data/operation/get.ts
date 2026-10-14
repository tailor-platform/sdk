import { arg } from "@politty/zod";
import { z } from "zod";
import { waitForCloneApplicationData } from "#/cli/commands/tailordb/migrate/test-runtime";
import { parseDuration } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import {
  cloneTimeoutArg,
  cloneWorkspaceArgs,
  formatElapsed,
  hintOnInterrupt,
  reportStatus,
  resumeCommandArgs,
  statusName,
} from "../shared";

export const getCommand = defineAppCommand({
  name: "get",
  description: "Show the status of a data clone, or wait for it to finish.",
  notes:
    "Without --wait, the command prints the current status once and exits. With --wait, it waits until the clone completes or fails, and exits with an error if it fails or --timeout passes.",
  args: z.strictObject({
    profile: arg(z.string().optional(), {
      alias: "p",
      description: "Workspace profile",
      env: "TAILOR_PLATFORM_PROFILE",
      completion: { type: "none" },
    }),
    ...cloneWorkspaceArgs,
    "operation-id": arg(z.string(), {
      description: "Operation ID printed when the clone started",
      completion: { type: "none" },
    }),
    wait: arg(z.boolean().default(false), {
      description: "Wait until the clone completes or fails",
    }),
    timeout: cloneTimeoutArg,
  }),
  run: async (args) => {
    const client = await initOperatorClient(await loadAccessToken({ profile: args.profile }));
    const ref = {
      sourceWorkspaceId: args.from,
      targetWorkspaceId: args.to,
      operationId: args["operation-id"],
      profile: args.profile,
    };

    if (!args.wait) {
      const operation = await client.getCloneApplicationDataOperation({
        sourceWorkspaceId: ref.sourceWorkspaceId,
        targetWorkspaceId: ref.targetWorkspaceId,
        operationId: ref.operationId,
      });
      const status = statusName(operation.status);
      logger.info(`Clone operation ${ref.operationId}: ${status}`);
      if (operation.errorMessage) logger.info(`Message: ${operation.errorMessage}`);
      logger.out({
        operationId: ref.operationId,
        status,
        ...(operation.errorMessage ? { errorMessage: operation.errorMessage } : {}),
      });
      return;
    }

    const startedAt = Date.now();
    await hintOnInterrupt(ref, () =>
      waitForCloneApplicationData(client, {
        sourceWorkspaceId: ref.sourceWorkspaceId,
        targetWorkspaceId: ref.targetWorkspaceId,
        operationId: ref.operationId,
        timeout: parseDuration(args.timeout),
        errorCodePrefix: "DATA_CLONE",
        onStatus: reportStatus,
        next: { command: "tailor", args: resumeCommandArgs(ref) },
      }),
    );
    logger.success(
      `Clone operation ${ref.operationId} completed in ${formatElapsed(Date.now() - startedAt)}`,
    );
    logger.out({ operationId: ref.operationId, status: "completed" });
  },
});
