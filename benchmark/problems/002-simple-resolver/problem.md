# Problem 002: Simple Resolver

## Objective

Create a simple query resolver that performs basic arithmetic operations.

## Requirements

Create `resolvers/calculator.ts` with a **default export** using `createResolver` from `@tailor-platform/sdk`.

### Resolver Specification

- **Name**: `"calculator"`
- **Operation**: `"query"`
- **Input**:
  - `a` — integer (`t.int()`)
  - `b` — integer (`t.int()`)
- **Body**: Takes the input and returns an object with:
  - `sum` — the sum of `a` and `b` (`a + b`)
  - `product` — the product of `a` and `b` (`a * b`)
- **Output**: object with:
  - `sum` — integer (`t.int()`)
  - `product` — integer (`t.int()`)

### Imports

```typescript
import { createResolver, t } from "@tailor-platform/sdk";
```

## Scaffold

A `tailor.config.ts` is provided that references `./resolvers/*.ts`.

## Example

Given input `{ a: 3, b: 4 }`, the resolver should return `{ sum: 7, product: 12 }`.
