import { createQueryResolver, t } from "@tailor-platform/tailor-sdk";
import { format } from "date-fns";

const input = t.type("StepChainInput", {
  name: t.string(),
});

const output = t.type("StepChainOutput", {
  step1: t.string(),
  step2: t.string(),
  sqlStep: t.string(),
});

export default createQueryResolver("stepChain", input, {
  defaults: { dbNamespace: "my-db" },
})
  .fnStep("step1", (args) => {
    console.log(args);
    return `step1: Hello ${args.input.name} on step1!`;
  })
  .fnStep("step2", async (args) => {
    console.log(args);
    return `step2: recorded ${format(
      new Date(),
      "yyyy-MM-dd HH:mm:ss",
    )} on step2!`;
  })
  .sqlStep("sqlStep", async (context) => {
    const result = await context.client.execOne<{ name: string }>(/* sql */ `
      SELECT name FROM User
    `);
    return result.name;
  })
  .returns(output);
