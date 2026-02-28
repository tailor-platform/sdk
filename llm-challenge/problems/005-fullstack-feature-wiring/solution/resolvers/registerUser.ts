import { createResolver, t } from "@tailor-platform/sdk";
import { getDB } from "../generated/tailordb";
import { onboardUser } from "../workflows/onboardingJobs";

export default createResolver({
  name: "registerUser",
  description: "Register a new user with duplicate email check",
  operation: "mutation",
  input: {
    email: t.string(),
    name: t.string(),
    plan: t.enum(["free", "basic", "premium", "enterprise"]),
    referralCode: t.string({ optional: true }),
  },
  body: async ({ input }) => {
    const db = getDB("tailordb");
    const existing = await db
      .selectFrom("Registration")
      .select(["id"])
      .where("email", "=", input.email)
      .executeTakeFirst();

    if (existing) {
      return {
        success: false,
        message: `Email ${input.email} is already registered`,
      };
    }

    const workflowRunId = await onboardUser.trigger({
      email: input.email,
      name: input.name,
      plan: input.plan,
      referralCode: input.referralCode ?? "",
    });

    return {
      success: true,
      message: `Registration initiated for ${input.email}`,
      workflowRunId: String(workflowRunId),
    };
  },
  output: t.object({
    success: t.bool(),
    message: t.string(),
    workflowRunId: t.string({ optional: true }),
  }),
});
