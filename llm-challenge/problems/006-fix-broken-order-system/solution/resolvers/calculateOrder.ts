import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "calculateOrder",
  description: "Calculate order totals with discount",
  operation: "query",
  input: {
    items: t.object(
      {
        name: t.string(),
        unitPrice: t.float(),
        quantity: t.int(),
      },
      { array: true },
    ),
    discountCode: t.string({ optional: true }),
    memberTier: t.enum(["bronze", "silver", "gold"]),
  },
  body: ({ input }) => {
    const subtotal = input.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

    let discountRate = 0;
    if (input.discountCode === "HALF") {
      discountRate = 0.5;
    } else if (input.discountCode === "QUARTER") {
      discountRate = 0.25;
    }

    const afterDiscount = subtotal * (1 - discountRate);

    let tierRate = 0;
    if (input.memberTier === "silver") {
      tierRate = 0.05;
    } else if (input.memberTier === "gold") {
      tierRate = 0.1;
    }

    const finalTotal = Math.max(0, afterDiscount * (1 - tierRate));

    const itemCount = input.items.reduce((sum, item) => sum + item.quantity, 0);

    return {
      subtotal,
      afterDiscount,
      finalTotal,
      itemCount,
    };
  },
  output: t.object({
    subtotal: t.float(),
    afterDiscount: t.float(),
    finalTotal: t.float(),
    itemCount: t.int(),
  }),
});
