import { z } from "zod";
import { organizationArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken } from "@/cli/shared/context";
import { humanizeRelativeTime } from "@/cli/shared/format";
import { logger } from "@/cli/shared/logger";
import { organizationInfo, type OrganizationInfo } from "./transform";

const getOrganizationOptionsSchema = z.object({
  organizationId: z.uuid({ message: "organization-id must be a valid UUID" }),
});

export type GetOrganizationOptions = z.input<typeof getOrganizationOptionsSchema>;

/**
 * Get detailed information about an organization.
 * @param options - Organization get options
 * @returns Organization details
 */
export async function getOrganization(options: GetOrganizationOptions): Promise<OrganizationInfo> {
  const result = getOrganizationOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(result.error.issues[0]!.message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const response = await client.getOrganization({
    organizationId: result.data.organizationId,
  });

  if (!response.organization) {
    throw new Error(`Organization "${result.data.organizationId}" not found.`);
  }

  return organizationInfo(response.organization);
}

export const getCommand = defineAppCommand({
  name: "get",
  description: "Show detailed information about an organization.",
  args: z
    .object({
      ...organizationArgs,
    })
    .strict(),
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
