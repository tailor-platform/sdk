import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "processOrder",
  operation: "mutation",
  input: {
    customer: t.object({
      name: t.string(),
      email: t.string(),
    }),
    items: t.object(
      {
        productName: t.string(),
        quantity: t.int(),
        unitPrice: t.float(),
      },
      { array: true },
    ),
    discountType: t.enum(["none", "percentage", "fixed"]),
    discountValue: t.float({ optional: true }),
  },
  body: ({ input }) => {
    const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

    let total = subtotal;
    if (input.discountValue != null) {
      if (input.discountType === "percentage") {
        total = subtotal - (subtotal * input.discountValue) / 100;
      } else if (input.discountType === "fixed") {
        total = subtotal - input.discountValue;
      }
    }
    total = Math.max(0, total);

    const itemCount = input.items.reduce((sum, item) => sum + item.quantity, 0);

    return {
      customerName: input.customer.name,
      subtotal,
      total,
      itemCount,
    };
  },
  output: t.object({
    customerName: t.string(),
    subtotal: t.float(),
    total: t.float(),
    itemCount: t.int(),
  }),
});
