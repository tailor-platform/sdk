import { format } from "date-fns";
import { db } from "tailordb";
import { createResolver, t } from "@tailor-platform/tailor-sdk";

export default createResolver({
  name: "stepChain",
  operation: "query",
  input: t.type({
    user: t.object({
      name: t.object({
        first: t
          .string()
          .validate([
            ({ value }) => value.length >= 2,
            "First name must be at least 2 characters",
          ]),
        last: t
          .string()
          .validate([
            ({ value }) => value.length >= 2,
            "Last name must be at least 2 characters",
          ]),
      }),
      activatedAt: t.datetime({ optional: true }),
    }),
  }),
  output: t.type({
    result: t.object({
      summary: t.string({ array: true }),
    }),
  }),
  body: async (context) => {
    const step1 = `step1: Hello ${context.input.user.name.first} ${context.input.user.name.last} on step1!`;
    const step2 = `step2: recorded ${format(
      new Date(),
      "yyyy-MM-dd HH:mm:ss",
    )} on step2!`;

    const kyselyResult = await db
      .selectFrom("Supplier")
      .select(["state"])
      .execute();
    const kyselyStep = kyselyResult.map((r) => r.state).join(", ");

    return {
      result: {
        summary: [step1, step2, kyselyStep],
      },
    };
  },
});
