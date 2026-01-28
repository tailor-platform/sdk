import { defineCommand } from "citty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { loadAccessToken, loadWorkspaceId } from "../../context";
import { humanizeRelativeTime } from "../../utils/format";
import { logger } from "../../utils/logger";
import { appHealthInfo, type AppHealthInfo } from "./transform";

const healthOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  name: z.string().min(1, { message: "name is required" }),
});

export type HealthOptions = z.input<typeof healthOptionsSchema>;

async function loadOptions(options: HealthOptions) {
  const result = healthOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(result.error.issues[0].message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: result.data.workspaceId,
    profile: result.data.profile,
  });

  return {
    client,
    workspaceId,
    name: result.data.name,
  };
}

/**
 * Get application schema health status.
 * @param options - Health check options
 * @returns Application health information
 */
export async function getAppHealth(options: HealthOptions): Promise<AppHealthInfo> {
  const { client, workspaceId, name } = await loadOptions(options);

  const response = await client.getApplicationSchemaHealth({
    workspaceId,
    applicationName: name,
  });

  return appHealthInfo(name, response);
}

export const healthCommand = defineCommand({
  meta: {
    name: "health",
    description: "Check application schema health",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
    name: {
      type: "string",
      description: "Application name",
      required: true,
      alias: "n",
    },
  },
  run: withCommonArgs(async (args) => {
    const health = await getAppHealth({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      name: args.name,
    });

    const formattedHealth = args.json
      ? health
      : {
          ...health,
          currentServingSchemaUpdatedAt: humanizeRelativeTime(health.currentServingSchemaUpdatedAt),
          lastAttemptAt: humanizeRelativeTime(health.lastAttemptAt),
        };

    logger.out(formattedHealth);
  }),
});
