# 002: Simple Resolver

## Goal

Create a simple query resolver that performs basic arithmetic operations.

## Instructions

Create the file `resolvers/calculator.ts` with a **default export** that defines a resolver.

### Resolver Specification

- **Name**: `"calculator"`
- **Operation**: `"query"`
- **Input**:
  - `a` — integer
  - `b` — integer
- **Body**: Takes the input and returns an object with:
  - `sum` — the sum of `a` and `b`
  - `product` — the product of `a` and `b`
- **Output**: object with:
  - `sum` — integer
  - `product` — integer

## Scaffold

A `tailor.config.ts` is provided that references `./resolvers/*.ts`.

## Example

Given input `{ a: 3, b: 4 }`, the resolver should return `{ sum: 7, product: 12 }`.

## Reference

Refer to the installed SDK package for resolver definition patterns.
