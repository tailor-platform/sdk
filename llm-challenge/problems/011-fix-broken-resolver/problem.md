# 011: Fix Broken Resolver

## Goal

Fix a broken resolver definition for a **calculateDiscount** resolver. The scaffold contains multiple intentional errors that must be corrected.

## Instructions

The file `resolvers/calculateDiscount/resolver.ts` is provided but contains several bugs. The resolver calculates a discounted price with membership bonuses.

The correct behavior:

1. Calculate discount: `price * (discountPercent / 100)`
2. Calculate finalPrice: `price - discount`
3. Apply membership bonus (gold=5%, silver=3%, bronze=0%)
4. **Clamp finalPrice to minimum 0** (never negative)
5. Return originalPrice, discountAmount, bonusPercent, and finalPrice

## Broken Code

```typescript
import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "calculate_discount",
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

## Requirements

- Resolver name must be `"calculateDiscount"` (camelCase, not underscores)
- `membershipLevel` enum must use array syntax: `t.enum([...])`
- Output must be wrapped with `t.object()`
- `finalPrice` must be clamped to minimum 0 (handle excessive discounts)
- Operation must be `"query"`
- The file must have a **default export**

## Reference

Refer to the installed SDK package for correct API usage of `t.enum()` and resolver output definition.
