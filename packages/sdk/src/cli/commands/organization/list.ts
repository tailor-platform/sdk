import { arg } from "politty";
import { z } from "zod";
import { positiveIntArg } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { userOrganizationInfo, type UserOrganizationInfo } from "./transform";

export interface ListOrganizationsOptions {
  limit?: number;
}

/**
 * List organizations the current user belongs to.
 * @param options - Organization listing options
 * @returns List of user organizations
 */
export async function listOrganizations(
  options?: ListOrganizationsOptions,
): Promise<UserOrganizationInfo[]> {
  const limit = options?.limit;
  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const { userOrganizations } = await client.listUserOrganizations({});
  const results = userOrganizations.map(userOrganizationInfo);

  if (limit !== undefined) {
    return results.slice(0, limit);
  }
  return results;
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List organizations you belong to.",
  args: z.strictObject({
    limit: arg(positiveIntArg.optional(), {
      alias: "l",
      description: "Maximum number of organizations to list",
    }),
  }),
  run: async (args) => {
    const organizations = await listOrganizations({ limit: args.limit });
    logger.out(organizations);
  },
});
