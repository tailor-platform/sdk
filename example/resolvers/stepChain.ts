import { createResolver, t } from "@tailor-platform/sdk";
import { format } from "date-fns";
import { getDB } from "../generated/tailordb";

export default createResolver({
  name: "stepChain",
  description: "Step chain operation with nested validation",
  operation: "query",
  input: {
    user: t
      .object({
        name: t
          .object({
            first: t
              .string()
              .description("User's first name")
              .validate([
                ({ value }) => value.length >= 2,
                "First name must be at least 2 characters",
              ]),
            last: t
              .string()
              .description("User's last name")
              .validate([
                ({ value }) => value.length >= 2,
                "Last name must be at least 2 characters",
              ]),
          })
          .description("User's full name"),
        activatedAt: t.datetime({ optional: true }).description("User activation timestamp"),
      })
      .typeName("StepChainUser")
      .description("User information"),
  },
  output: t
    .object({
      result: t
        .object({
          summary: t.string({ array: true }).description("Summary of processing steps"),
        })
        .description("Processing result"),
    })
    .description("Result of step chain operation"),
  body: async (context) => {
    const step1 = `step1: Hello ${context.input.user.name.first} ${context.input.user.name.last} on step1!`;
    const step2 = `step2: recorded ${format(new Date(), "yyyy-MM-dd HH:mm:ss")} on step2!`;

    const db = getDB("tailordb");
    const kyselyResult = await db.selectFrom("Supplier").select(["state"]).execute();
    const kyselyStep = kyselyResult.map((r) => r.state).join(", ");

    return {
      result: {
        summary: [step1, step2, kyselyStep],
      },
    };
  },
});
