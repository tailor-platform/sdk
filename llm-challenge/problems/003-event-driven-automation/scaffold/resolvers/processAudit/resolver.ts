import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "processAudit",
  description: "Process an audit action",
  operation: "mutation",
  input: {
    action: t.string(),
    targetId: t.string(),
  },
  body: ({ input }) => ({
    success: true,
    action: input.action,
    targetId: input.targetId,
  }),
  output: t.object({
    success: t.bool(),
    action: t.string(),
    targetId: t.string(),
  }),
});
