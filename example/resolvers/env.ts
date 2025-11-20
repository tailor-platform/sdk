import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "env",
  description: "Test environment variables",
  operation: "query",
  input: {
    multiplier: t.int().description("Number to multiply with env.foo"),
  },
  body: ({ input, env }) => {
    console.log("Environment variables:", env);
    console.log("Input:", input);

    return {
      result: input.multiplier * env.foo,
      envBar: env.bar,
      envBaz: env.baz,
    };
  },
  output: t.object({
    result: t.int().description("Result of multiplication"),
    envBar: t.string().description("Value of env.bar"),
    envBaz: t.bool().description("Value of env.baz"),
  }),
});
