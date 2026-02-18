import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "calculateDiscount",
  operation: "query",
  input: {
    price: t.float(),
    discountPercent: t.float(),
    membershipLevel: t.enum(["gold", "silver", "bronze"]),
  },
  body: ({ input }) => {
    const discount = input.price * (input.discountPercent / 100);
    const finalPrice = input.price - discount;
    let bonus = 0;
    if (input.membershipLevel === "gold") {
      bonus = 5;
    } else if (input.membershipLevel === "silver") {
      bonus = 3;
    }
    const afterBonus = finalPrice - (finalPrice * bonus) / 100;
    return {
      originalPrice: input.price,
      discountAmount: discount,
      bonusPercent: bonus,
      finalPrice: Math.max(0, afterBonus),
    };
  },
  output: t.object({
    originalPrice: t.float(),
    discountAmount: t.float(),
    bonusPercent: t.int(),
    finalPrice: t.float(),
  }),
});
