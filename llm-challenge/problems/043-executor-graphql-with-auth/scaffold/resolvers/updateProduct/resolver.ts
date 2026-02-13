import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "updateProduct",
  operation: "mutation",
  input: {
    id: t.string(),
    name: t.string(),
    price: t.float(),
  },
  body: ({ input }) => {
    return { id: input.id, updated: true };
  },
  output: t.object({
    id: t.string(),
    updated: t.bool(),
  }),
});
