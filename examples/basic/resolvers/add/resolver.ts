import { createResolver, t } from "@tailor-platform/tailor-sdk";

const validators: [(a: { value: number }) => boolean, string][] = [
  [({ value }) => value >= 0, "Value must be non-negative"],
  [({ value }) => value < 10, "Value must be less than 10"],
];
export default createResolver({
  name: "add",
  operation: "query",
  input: t.type({
    a: t.int().validate(...validators),
    b: t.int().validate(...validators),
  }),
  body: (context) => {
    console.log(JSON.stringify(context, null, 2));
    return { result: context.input.a + context.input.b };
  },
  output: t.type({
    result: t.int(),
  }),
});
