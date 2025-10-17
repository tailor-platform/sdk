import { createResolver, t } from "@tailor-platform/tailor-sdk";

export default createResolver({
  name: "hello",
  operation: "query",
  input: t.type({
    name: t.string(),
  }),
  body: (context) => {
    return {
      message: `Hello, ${context.input.name}!`,
    };
  },
  output: t.type({
    message: t.string(),
  }),
});
