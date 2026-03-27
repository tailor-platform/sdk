import { ExecutorTriggerType } from "@tailor-proto/tailor/v1/executor_resource_pb";
import { defineCommand, runCommand } from "politty";
import { z } from "zod";
import { workspaceArgs } from "@/cli/shared/args";
import { fetchAll, initOperatorClient, platformBaseUrl } from "@/cli/shared/client";
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
 * Build the webhook URL for an executor.
 * @param workspaceId - Workspace ID
 * @param executorName - Executor name
 * @returns Webhook URL
 */
function buildWebhookUrl(workspaceId: string, executorName: string): string {
  return `${platformBaseUrl}/webhook/v1/${workspaceId}/executor/${executorName}`;
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

  const executors = await fetchAll(async (pageToken, maxPageSize) => {
    const { executors, nextPageToken } = await client.listExecutorExecutors({
      workspaceId,
      pageToken,
      pageSize: maxPageSize,
    });
    return [executors, nextPageToken];
  });

  // Filter only incoming webhook triggers
  const webhookExecutors = executors.filter(
    (e) => e.triggerType === ExecutorTriggerType.INCOMING_WEBHOOK,
  );

  return webhookExecutors.map((e) => ({
    name: e.name,
    webhookUrl: buildWebhookUrl(workspaceId, e.name),
    disabled: e.disabled,
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
