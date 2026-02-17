import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "calculator",
  operation: "query",
  input: {
    a: t.int(),
    b: t.int(),
  },
  body: ({ input }) => ({
    sum: input.a + input.b,
    product: input.a * input.b,
  }),
  output: t.object({
    sum: t.int(),
    product: t.int(),
  }),
});
