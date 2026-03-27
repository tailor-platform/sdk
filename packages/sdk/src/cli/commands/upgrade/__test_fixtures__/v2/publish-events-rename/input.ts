import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "createOrder",
  operation: "mutation",
  publishEvents: true,
  input: {
    productId: t.string(),
    quantity: t.int(),
  },
  body: async ({ _input }) => {
    return { orderId: "order-123" };
  },
  output: t.object({ orderId: t.string() }),
});
