import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "pricingCalculator",
  description: "Calculate pricing with coupon and member rank discounts",
  operation: "mutation",
  input: {
    items: t.object(
      {
        name: t.string(),
        unitPrice: t.float(),
        quantity: t.int(),
      },
      { array: true },
    ),
    couponCode: t.string({ optional: true }),
    memberRank: t.enum(["bronze", "silver", "gold", "platinum"], { optional: true }),
  },
  body: ({ input }) => {
    if (input.items.length === 0) {
      return { subtotal: 0, discountedSubtotal: 0, finalTotal: 0, itemCount: 0 };
    }

    const subtotal = input.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

    const couponRates: Record<string, number> = {
      SAVE10: 0.1,
      SAVE20: 0.2,
    };
    const couponRate = input.couponCode != null ? (couponRates[input.couponCode] ?? 0) : 0;
    const discountedSubtotal = subtotal * (1 - couponRate);

    const rankRates: Record<string, number> = {
      bronze: 0,
      silver: 0.05,
      gold: 0.1,
      platinum: 0.15,
    };
    const rankRate = input.memberRank != null ? (rankRates[input.memberRank] ?? 0) : 0;
    const finalTotal = Math.max(0, discountedSubtotal * (1 - rankRate));

    const itemCount = input.items.reduce((sum, item) => sum + item.quantity, 0);

    return { subtotal, discountedSubtotal, finalTotal, itemCount };
  },
  output: t.object({
    subtotal: t.float(),
    discountedSubtotal: t.float(),
    finalTotal: t.float(),
    itemCount: t.int(),
  }),
});
