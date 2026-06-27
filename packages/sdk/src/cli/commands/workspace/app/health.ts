import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import { assertDefined } from "#/utils/assert";
import { appHealthInfo, type AppHealthInfo } from "./transform";

const healthOptionsSchema = /* strip unknown keys */ z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  name: z.string().min(1, { message: "name is required" }),
});

export type HealthOptions = z.input<typeof healthOptionsSchema>;

async function loadOptions(options: HealthOptions) {
  const result = healthOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(assertDefined(result.error.issues[0], "Zod returned no issues").message);
  }

  const accessToken = await loadAccessToken({ profile: result.data.profile });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
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

export const healthCommand = defineAppCommand({
  name: "health",
  description: "Check application schema health",
  args: z.strictObject({
    ...workspaceArgs,
    name: arg(z.string(), {
      description: "Application name",
      alias: "n",
    }),
  }),
  run: async (args) => {
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
  },
});
