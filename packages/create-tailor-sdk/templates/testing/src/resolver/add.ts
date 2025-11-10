import { createResolver, t } from "@tailor-platform/tailor-sdk";

const resolver = createResolver({
  name: "add",
  operation: "query",
  input: {
    left: t.int(),
    right: t.int(),
  },
  body: (context) => {
    return context.input.left + context.input.right;
  },
  output: t.int(),
});

export default resolver;
