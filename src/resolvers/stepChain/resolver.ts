import { createQueryResolver, t } from "@tailor-platform/tailor-sdk";
import { format } from "date-fns";
import { kyselyWrapper } from "../tailordb";

export default createQueryResolver(
  "stepChain",
  t.type({
    user: t.object({ name: t.object({ first: t.string(), last: t.string() }) }),
  }),
  { defaults: { dbNamespace: "tailordb" } },
)
  .fnStep("step1", (context) => {
    return `step1: Hello ${context.input.user.name.first} ${context.input.user.name.last} on step1!`;
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

  .sqlStep("kyselyStep", (context) =>
    kyselyWrapper(context, async (context) => {
      const query = context.db
        .selectFrom("Supplier")
        .select(["state"])
        .compile();

      return (await context.client.exec(query)).map((r) => r.state).join(", ");
    }),
  )

  .returns(
    (context) => ({
      result: {
        summary: [
          context.step1,
          context.step2,
          context.sqlStep,
          context.kyselyStep,
        ],
      },
    }),
    t.type({
      result: t.object({
        summary: t.string().array(),
      }),
    }),
  );
