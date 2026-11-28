import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "decimalEcho",
  description: "Add two decimals and return the sum, using Decimal values in the body",
  operation: "query",
  input: {
    a: t.decimal({ as: "decimal" }),
    b: t.decimal({ as: "decimal" }),
  },
  output: t.object({
    sum: t.decimal({ as: "decimal" }),
    isDecimal: t.bool(),
  }),
  body: ({ input }) => ({
    sum: input.a.plus(input.b),
    isDecimal: typeof input.a.plus === "function",
  }),
});
