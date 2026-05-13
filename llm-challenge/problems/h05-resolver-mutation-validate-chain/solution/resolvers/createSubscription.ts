import { createResolver, t } from "@tailor-platform/sdk";
import { subscription } from "../tailordb/subscription";

export default createResolver({
  name: "createSubscription",
  operation: "mutation",
  input: {
    plan: t.string(),
    price: t.float(),
  },
  output: t.object({
    success: t.bool(),
    errors: t.string({ array: true }),
  }),
  body: ({ input, user }) => {
    const errors: string[] = [];
    const planResult = subscription.fields.plan.parse({
      value: input.plan,
      data: { plan: input.plan, price: input.price },
      user,
    });
    for (const issue of planResult.issues ?? []) {
      errors.push(issue.message);
    }
    const priceResult = subscription.fields.price.parse({
      value: input.price,
      data: { plan: input.plan, price: input.price },
      user,
    });
    for (const issue of priceResult.issues ?? []) {
      errors.push(issue.message);
    }
    return { success: errors.length === 0, errors };
  },
});
