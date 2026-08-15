import { arg } from "@politty/valibot";
import * as v from "valibot";
import { organizationArgs } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { organizationInfo, type OrganizationInfo } from "./transform";

// strip unknown keys
const updateOrganizationOptionsSchema = v.object({
  organizationId: v.pipe(v.string(), v.uuid("organization-id must be a valid UUID")),
  name: v.pipe(v.string(), v.minLength(1, "Name must not be empty")),
});

export type UpdateOrganizationOptions = v.InferInput<typeof updateOrganizationOptionsSchema>;

/**
 * Update an organization's name.
 * @param options - Organization update options
 * @returns Updated organization details
 */
export async function updateOrganization(
  options: UpdateOrganizationOptions,
): Promise<OrganizationInfo> {
  const result = v.safeParse(updateOrganizationOptionsSchema, options);
  if (!result.success) {
    throw new Error(result.issues[0].message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);

  const response = await client.updateOrganization({
    organizationId: result.output.organizationId,
    organizationName: result.output.name,
  });

  if (!response.organization) {
    throw new Error(`Failed to update organization "${result.output.organizationId}".`);
  }

  return organizationInfo(response.organization);
}

export const updateCommand = defineAppCommand({
  name: "update",
  description: "Update an organization's name.",
  args: v.strictObject({
    ...organizationArgs,
    name: arg(v.string(), {
      alias: "n",
      description: "New organization name",
    }),
  }),
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
