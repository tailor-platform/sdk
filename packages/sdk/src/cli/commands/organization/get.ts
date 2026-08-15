import * as v from "valibot";
import { organizationArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import { organizationInfo, type OrganizationInfo } from "./transform";

// strip unknown keys
const getOrganizationOptionsSchema = v.object({
  organizationId: v.pipe(v.string(), v.uuid("organization-id must be a valid UUID")),
});

export type GetOrganizationOptions = v.InferInput<typeof getOrganizationOptionsSchema>;

/**
 * Get detailed information about an organization.
 * @param options - Organization get options
 * @returns Organization details
 */
export async function getOrganization(options: GetOrganizationOptions): Promise<OrganizationInfo> {
  const result = v.safeParse(getOrganizationOptionsSchema, options);
  if (!result.success) {
    throw new Error(result.issues[0].message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const response = await client.getOrganization({
    organizationId: result.output.organizationId,
  });

  if (!response.organization) {
    throw new Error(`Organization "${result.output.organizationId}" not found.`);
  }

  return organizationInfo(response.organization);
}

export const getCommand = defineAppCommand({
  name: "get",
  description: "Show detailed information about an organization.",
  args: v.strictObject({
    ...organizationArgs,
  }),
  run: async (args) => {
    const organization = await getOrganization({
      organizationId: args["organization-id"],
    });

    const formattedOrganization = args.json
      ? organization
      : {
          ...organization,
          createdAt: humanizeRelativeTime(organization.createdAt),
          updatedAt: humanizeRelativeTime(organization.updatedAt),
        };

    logger.out(formattedOrganization);
  },
});
