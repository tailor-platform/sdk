import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "cancelOrder",
  operation: "mutation",
  input: {
    orderId: t.string(),
  },
  body: ({ input }) => ({ success: true, orderId: input.orderId }),
  output: t.object({
    success: t.bool(),
    orderId: t.string(),
  }),
});
