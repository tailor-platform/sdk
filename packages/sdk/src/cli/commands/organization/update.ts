import { arg } from "politty";
import { z } from "zod";
import { organizationArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { assertWritable } from "@/cli/shared/readonly-guard";
import { organizationInfo, type OrganizationInfo } from "./transform";

const updateOrganizationOptionsSchema = z.object({
  organizationId: z.uuid({ message: "organization-id must be a valid UUID" }),
  name: z.string().min(1, "Name must not be empty"),
});

export type UpdateOrganizationOptions = z.input<typeof updateOrganizationOptionsSchema>;

/**
 * Update an organization's name.
 * @param options - Organization update options
 * @returns Updated organization details
 */
export async function updateOrganization(
  options: UpdateOrganizationOptions,
): Promise<OrganizationInfo> {
  const result = updateOrganizationOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(result.error.issues[0]!.message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const response = await client.updateOrganization({
    organizationId: result.data.organizationId,
    organizationName: result.data.name,
  });

  if (!response.organization) {
    throw new Error(`Failed to update organization "${result.data.organizationId}".`);
  }

  return organizationInfo(response.organization);
}

export const updateCommand = defineAppCommand({
  name: "update",
  description: "Update an organization's name.",
  args: z
    .object({
      ...organizationArgs,
      name: arg(z.string(), {
        alias: "n",
        description: "New organization name",
      }),
    })
    .strict(),
  run: async (args) => {
    await assertWritable();
    const organization = await updateOrganization({
      organizationId: args["organization-id"],
      name: args.name,
    });

    if (!args.json) {
      logger.success(`Organization "${organization.name}" updated successfully.`);
    }

    logger.out(organization);
  },
});
