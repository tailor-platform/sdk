import { defineCommand, runCommand } from "politty";
import { z } from "zod";
import { workspaceArgs } from "@/cli/shared/args";
import { fetchAll, initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger, styles } from "@/cli/shared/logger";

export interface WebhookExecutorInfo {
  name: string;
  webhookUrl: string;
  disabled: boolean;
}

export interface ListWebhookExecutorsOptions {
  workspaceId?: string;
  profile?: string;
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
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  const webhooks = await fetchAll(async (pageToken, maxPageSize) => {
    const { webhooks, nextPageToken } = await client.listExecutorIncomingWebhooks({
      workspaceId,
      pageToken,
      pageSize: maxPageSize,
    });
    return [webhooks, nextPageToken];
  });

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
    })
    .strict(),
  run: async (args) => {
    const executors = await listWebhookExecutors({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    if (executors.length === 0) {
      logger.info("No webhook executors found.");
      return;
    }

    logger.out(executors, {
      display: {
        disabled: (v) => (v ? styles.warning("true") : styles.dim("false")),
      },
    });

    if (!args.json) {
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
