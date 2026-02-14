import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "getProduct",
  operation: "query",
  input: {
    productId: t.string(),
  },
  body: ({ input }) => {
    return { id: input.productId, name: "Sample Product" };
  },
  output: t.object({
    id: t.string(),
    name: t.string(),
  }),
});
