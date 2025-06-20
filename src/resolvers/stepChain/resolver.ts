import { createQueryResolver, t } from "@tailor-platform/tailor-sdk";
import { format } from "date-fns";

export default createQueryResolver(
  "stepChain",
  t.type("StepChainInput", { name: t.string() }),
  { defaults: { dbNamespace: "my-db" } },
)
  .fnStep("step1", (context) => {
    return `step1: Hello ${context.input.name} on step1!`;
  })

  .fnStep("step2", async () => {
    return `step2: recorded ${format(
      new Date(),
      "yyyy-MM-dd HH:mm:ss",
    )} on step2!`;
  })

  .sqlStep("sqlStep", async (context) => {
    const result = await context.client.execOne<{ name: string }>(
      /* sql */ `SELECT name FROM User`,
    );
    return result.name;
  })

  .returns(
    (context) => ({
      summary: [context.step1, context.step2, context.sqlStep],
    }),
    t.type("StepChainOutput", {
      summary: t.string().array(),
    }),
  );
