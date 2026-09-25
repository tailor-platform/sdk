import { createResolver, t } from "@tailor-platform/sdk";
import { approval } from "../workflow/approval";

export default createResolver({
  name: "resolveApproval",
  description: "Resolve a waiting approval",
  operation: "mutation",
  input: {
    executionId: t.string(),
    approved: t.bool(),
  },
  body: async ({ input }) => {
    await approval.resolve(input.executionId, () => {
      return { approved: input.approved };
    });

    return { resolved: true };
  },
  output: t.object({
    resolved: t.bool(),
  }),
});
