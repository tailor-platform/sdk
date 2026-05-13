import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "upgrade",
  operation: "mutation",
  input: {
    customerId: t.string(),
    plan: t.string(),
  },
  body: ({ input }) => ({
    success: true,
    customerId: input.customerId,
    plan: input.plan,
  }),
  output: t.object({
    success: t.bool(),
    customerId: t.string(),
    plan: t.string(),
  }),
});
