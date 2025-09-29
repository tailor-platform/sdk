import { createQueryResolver, t } from "@tailor-platform/tailor-sdk";

export default createQueryResolver(
  "hello",
  t.type({
    name: t.string(),
  }),
)
  .fnStep("greet", (context) => {
    return `Hello, ${context.input.name}!`;
  })
  .returns(
    (context) => ({
      message: context.greet,
    }),
    t.type({
      message: t.string(),
    }),
  );
