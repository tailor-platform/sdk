import { createResolver, t } from "@tailor-platform/tailor-sdk";

export default createResolver({
  name: "add",
  operation: "mutation",
  input: t.type({
    a: t.int(),
    b: t.int(),
  }),
  body: (context) => {
    return { result: context.input.a + context.input.b };
  },
  output: t.type({
    result: t.int(),
  }),
});
