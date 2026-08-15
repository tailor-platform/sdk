import { arg } from "@politty/valibot";
import * as v from "valibot";
import { workspaceArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import { assertDefined } from "#/utils/assert";
import { appHealthInfo, type AppHealthInfo } from "./transform";

// strip unknown keys
const healthOptionsSchema = v.object({
  workspaceId: v.optional(v.pipe(v.string(), v.uuid("workspace-id must be a valid UUID"))),
  profile: v.optional(v.string()),
  name: v.pipe(v.string(), v.minLength(1, "name is required")),
});

export type HealthOptions = v.InferInput<typeof healthOptionsSchema>;

async function loadOptions(options: HealthOptions) {
  const result = v.safeParse(healthOptionsSchema, options);
  if (!result.success) {
    throw new Error(assertDefined(result.issues[0], "Valibot returned no issues").message);
  }

  const accessToken = await loadAccessToken({ profile: result.output.profile });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: result.output.workspaceId,
    profile: result.output.profile,
  });

  return {
    client,
    workspaceId,
    name: result.output.name,
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
  args: v.strictObject({
    ...workspaceArgs,
    name: arg(v.string(), {
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
