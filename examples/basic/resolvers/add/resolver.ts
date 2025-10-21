import { createResolver, t } from "@tailor-platform/tailor-sdk";

export default createResolver({
  name: "add",
  operation: "query",
  input: t.type({
    a: t.int(),
    b: t.int(),
  }),
  body: (context) => {
    console.log(JSON.stringify(context, null, 2));
    return { result: context.input.a + context.input.b };
  },
  output: t.type({
    result: t.int(),
  }),
});
