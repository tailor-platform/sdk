import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "calculate_order",
  description: "Calculate order totals with discount",
  operation: "query",
  input: {
    items: t.object(
      {
        name: t.string(),
        unit_price: t.float(),
        quantity: t.int(),
      },
      { array: true },
    ),
    discount_code: t.string({ optional: true }),
    member_tier: t.enum(["bronze", "silver", "gold"]),
  },
  body: ({ input }) => {
    const subtotal = input.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);

    let discountRate = 0;
    if (input.discount_code === "HALF") {
      discountRate = 50;
    } else if (input.discount_code === "QUARTER") {
      discountRate = 25;
    }

    const afterDiscount = subtotal * (1 - discountRate);

    let tierRate = 0;
    if (input.member_tier === "silver") {
      tierRate = 0.05;
    } else if (input.member_tier === "gold") {
      tierRate = 0.1;
    }

    const finalTotal = afterDiscount * (1 - tierRate);

    return {
      subtotal,
      after_discount: afterDiscount,
      final_total: finalTotal,
      item_count: input.items.length,
    };
  },
  output: t.object({
    subtotal: t.float(),
    after_discount: t.float(),
    final_total: t.float(),
    item_count: t.int(),
  }),
});
