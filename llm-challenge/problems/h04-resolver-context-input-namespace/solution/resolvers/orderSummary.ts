import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "orderSummary",
  operation: "query",
  input: {
    orderId: t.string(),
  },
  body: ({ input, user }) => ({
    orderId: input.orderId,
    viewerId: user.id,
  }),
  output: t.object({
    orderId: t.string(),
    viewerId: t.string(),
  }),
});
