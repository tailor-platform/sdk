import { createWorkflow, createWorkflowJob, defineWaitPoints } from "@tailor-platform/sdk";
import { getDB } from "../generated/tailordb";

export const { adminApproval } = defineWaitPoints((define) => ({
  adminApproval: define<{ organizationId: string }, { approved: boolean }>(),
}));

export const loadOrganization = createWorkflowJob({
  name: "load-organization",
  body: async (input: { organizationId: string }) => {
    const row = await getDB("tailordb")
      .selectFrom("Organization")
      .select(["name"])
      .where("id", "=", input.organizationId)
      .executeTakeFirstOrThrow();
    return { name: row.name };
  },
});

export const provisionOrg = createWorkflowJob({
  name: "provision-org",
  body: async (input: { organizationId: string }) => {
    const { name } = await loadOrganization.trigger({ organizationId: input.organizationId });
    const { approved } = await adminApproval.wait({ organizationId: input.organizationId });
    return { organizationId: input.organizationId, name, approved };
  },
});

export default createWorkflow({
  name: "onboarding",
  mainJob: provisionOrg,
});
