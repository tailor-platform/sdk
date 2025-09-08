import { createMutationResolver, t } from "@tailor-platform/tailor-sdk";

const resolver = createMutationResolver(
  "add",
  t.type({
    a: t.int(),
    b: t.int(),
  }),
)
  .fnStep("step1", (context) => {
    return context.input.a + context.input.b;
  })
  .returns(
    (context) => ({
      result: context.step1,
    }),
    t.type({
      result: t.int(),
    }),
  );
export default resolver;
