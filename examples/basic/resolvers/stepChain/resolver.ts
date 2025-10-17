import { createResolver, t } from "@tailor-platform/tailor-sdk";
import { format } from "date-fns";
import { kyselyWrapper } from "generated/tailordb";

export default createResolver({
  name: "stepChain",
  operation: "query",
  input: t.type({
    user: t.object({
      name: t.object({ first: t.string(), last: t.string() }),
      activatedAt: t.datetime({ optional: true }),
    }),
  }),
  output: t.type({
    result: t.object({
      summary: t.string({ array: true }),
    }),
  }),
  options: { dbNamespace: "tailordb" },
  body: async (context) => {
    const step1 = `step1: Hello ${context.input.user.name.first} ${context.input.user.name.last} on step1!`;
    const step2 = `step2: recorded ${format(
      new Date(),
      "yyyy-MM-dd HH:mm:ss",
    )} on step2!`;

    const result = await context.client.execOne<{ name: string } | null>(
      /* sql */ `SELECT name FROM User ORDER BY createdAt DESC`,
    );
    const sqlStep = result ? result.name : "no user found";

    const kyselyStep = await kyselyWrapper(context, async (context) => {
      const query = context.db
        .selectFrom("Supplier")
        .select(["state"])
        .compile();

      return (await context.client.exec(query)).map((r) => r.state).join(", ");
    });

    return {
      result: {
        summary: [step1, step2, sqlStep, kyselyStep],
      },
    };
  },
});
