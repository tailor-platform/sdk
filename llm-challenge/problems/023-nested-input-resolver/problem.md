# 023: Nested Input Resolver

## Goal

Create a mutation resolver with deeply nested input objects and complex computation logic.

## Instructions

Create the file `resolvers/processOrder.ts` with a **default export** that defines a resolver.

### Resolver Specification

- **Name**: `"processOrder"`
- **Operation**: `"mutation"`
- **Input**:
  - `customer` — object with:
    - `name` — string
    - `email` — string
  - `items` — array of objects, each with:
    - `productName` — string
    - `quantity` — integer
    - `unitPrice` — float
  - `discountType` — enum with values: `"none"`, `"percentage"`, `"fixed"`
  - `discountValue` — float (optional)
- **Body**: Takes the input and computes:
  1. `subtotal` — sum of (quantity \* unitPrice) for all items
  2. Apply discount:
     - `"none"`: no discount
     - `"percentage"`: subtract `(subtotal * discountValue / 100)` (if discountValue provided)
     - `"fixed"`: subtract `discountValue` from subtotal (if discountValue provided)
  3. `total` — the final amount after discount (minimum 0)
  4. `itemCount` — total number of items (sum of quantities)
  5. Return: `{ customerName: customer.name, subtotal, total, itemCount }`
- **Output**: object with:
  - `customerName` — string
  - `subtotal` — float
  - `total` — float
  - `itemCount` — integer

## Example

Given input:

```json
{
  "customer": { "name": "Alice", "email": "alice@example.com" },
  "items": [
    { "productName": "Widget", "quantity": 2, "unitPrice": 10.0 },
    { "productName": "Gadget", "quantity": 1, "unitPrice": 25.5 }
  ],
  "discountType": "percentage",
  "discountValue": 10
}
```

The resolver should return:

```json
{ "customerName": "Alice", "subtotal": 45.5, "total": 40.95, "itemCount": 3 }
```

## Reference

Refer to the installed SDK package for resolver definition patterns.
