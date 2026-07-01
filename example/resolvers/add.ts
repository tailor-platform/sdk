import { createResolver, t } from "@tailor-platform/sdk";

const validators = [
  ({ newValue }: { newValue: number }) =>
    newValue >= 0 ? undefined : "Value must be non-negative",
  ({ newValue }: { newValue: number }) =>
    newValue < 10 ? undefined : "Value must be less than 10",
] as const;
export default createResolver({
  name: "add",
  description: "Addition operation",
  operation: "query",
  input: {
    a: t
      .int()
      .description("First number to add")
      .validate(...validators),
    b: t
      .int()
      .description("Second number to add")
      .validate(...validators),
  },
  body: ({ input }) => input.a + input.b,
  output: t.int().description("Sum of the two input numbers"),
});
