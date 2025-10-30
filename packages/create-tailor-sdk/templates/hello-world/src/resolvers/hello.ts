import { createResolver, t } from "@tailor-platform/tailor-sdk";

export default createResolver({
  name: "hello",
  operation: "query",
  input: t
    .type({
      name: t.string().description("Name to greet"),
    })
    .description("Input parameters for hello query"),
  body: (context) => {
    return {
      message: `Hello, ${context.input.name}!`,
    };
  },
  output: t
    .type({
      message: t.string().description("Greeting message"),
    })
    .description("Greeting response"),
});
