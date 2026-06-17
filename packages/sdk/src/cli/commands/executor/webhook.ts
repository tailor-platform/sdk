import { defineCommand, runCommand } from "politty";
import { z } from "zod";
import { type Order, paginationArgs, toPageDirection, workspaceArgs } from "#src/cli/shared/args";
import { fetchPaged, initOperatorClient } from "#src/cli/shared/client";
import { defineAppCommand } from "#src/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#src/cli/shared/context";
import { logger, styles } from "#src/cli/shared/logger";

export interface WebhookExecutorInfo {
  name: string;
  webhookUrl: string;
  disabled: boolean;
}

export interface ListWebhookExecutorsOptions {
  workspaceId?: string;
  profile?: string;
  order?: Order;
  limit?: number;
}

/**
 * List executors with incoming webhook triggers and return CLI-friendly info.
 * @param options - Listing options
 * @returns List of webhook executors with URLs
 */
export async function listWebhookExecutors(
  options?: ListWebhookExecutorsOptions,
): Promise<WebhookExecutorInfo[]> {
  const accessToken = await loadAccessToken({
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  const pageDirection = toPageDirection(options?.order);
  const webhooks = await fetchPaged(
    async (pageToken, pageSize) => {
      const { webhooks, nextPageToken } = await client.listExecutorIncomingWebhooks({
        workspaceId,
        pageToken,
        pageSize,
        pageDirection,
      });
      return [webhooks, nextPageToken];
    },
    { limit: options?.limit },
  );

  return webhooks.map((w) => ({
    name: w.executorName,
    webhookUrl: w.url,
    disabled: w.disabled,
  }));
}

const listWebhookCommand = defineAppCommand({
  name: "list",
  description: "List executors with incoming webhook triggers",
  args: z
    .object({
      ...workspaceArgs,
      ...paginationArgs(),
    })
    .strict(),
  run: async (args) => {
    const jsonOutput = logger.jsonMode;
    const executors = await listWebhookExecutors({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      order: args.order,
      limit: args.limit,
    });

    if (executors.length === 0) {
      logger.info("No webhook executors found.");
      if (jsonOutput) {
        logger.out([]);
      }
      return;
    }

    logger.out(executors, {
      display: {
        disabled: (v) => (v ? styles.warning("true") : styles.dim("false")),
      },
    });

    if (!jsonOutput) {
      logger.info(
        'To test a webhook, run: tailor-sdk executor trigger <name> -d \'{"key":"value"}\'',
      );
    }
  },
});

export const webhookCommand = defineCommand({
  name: "webhook",
  description: "Manage executor webhooks",
  subCommands: {
    list: listWebhookCommand,
  },
  async run() {
    await runCommand(listWebhookCommand, []);
  },
});
