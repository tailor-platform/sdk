import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "hello",
  operation: "query",
  input: {
    name: t.string().description("Name to greet"),
  },
  body: (context) => {
    return {
      message: `Hello, ${context.input.name}!`,
    };
  },
  output: t
    .object({
      message: t.string().description("Greeting message"),
    })
    .description("Greeting response"),
});
