import { createResolver, t } from "@tailor-platform/tailor-sdk";

const validators: [(a: { value: number }) => boolean, string][] = [
  [({ value }) => value >= 0, "Value must be non-negative"],
  [({ value }) => value < 10, "Value must be less than 10"],
];
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
  body: (context) => {
    console.log(JSON.stringify(context, null, 2));
    return { result: context.input.a + context.input.b };
  },
  output: t
    .object({
      result: t.int().description("Sum of the two input numbers"),
    })
    .description("Result of addition operation"),
});
