# 041: Fix Broken Resolver

## Goal

Fix a broken resolver definition for a **calculateDiscount** resolver. The scaffold contains intentional errors that must be corrected.

## Instructions

The file `resolvers/calculateDiscount/resolver.ts` is provided but contains bugs. The resolver is meant to calculate a discounted price with membership bonuses.

Here is the broken code:

```typescript
import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "calculateDiscount",
  operation: "query",
  input: {
    price: t.float(),
    discountPercent: t.float(),
    membershipLevel: t.enum("gold", "silver", "bronze"),
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
    return {
      originalPrice: input.price,
      discountAmount: discount,
      bonusPercent: bonus,
      finalPrice: finalPrice - (finalPrice * bonus) / 100,
    };
  },
  output: {
    originalPrice: t.float(),
    discountAmount: t.float(),
    bonusPercent: t.int(),
    finalPrice: t.float(),
  },
});
```

Find and fix all the bugs so the resolver works correctly.

## Requirements

- The resolver name must be `"calculateDiscount"`
- The operation must be `"query"`
- Input must have `price` (float), `discountPercent` (float), and `membershipLevel` (enum with values `"gold"`, `"silver"`, `"bronze"`)
- The body logic must remain the same (calculate discount, apply membership bonus)
- Output must have `originalPrice` (float), `discountAmount` (float), `bonusPercent` (int), and `finalPrice` (float)
- The file must have a **default export**

## Reference

Refer to the installed SDK package for correct API usage of `t.enum()` and resolver output definition.
