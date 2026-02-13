# 005: Array Input/Output Resolver

## Goal

Create a query resolver that categorizes an array of numbers.

## Instructions

Create the file `resolvers/categorizeNumbers.ts` with a **default export** that defines a resolver.

### Resolver Specification

- **Name**: `"categorizeNumbers"`
- **Operation**: `"query"`
- **Input**:
  - `numbers` — array of integers
- **Body**: Takes the input array and returns:
  - `positives` — array of integers (numbers > 0)
  - `negatives` — array of integers (numbers < 0)
  - `zeros` — integer (count of zeros)
  - `summary` — enum with value `"all_positive"`, `"all_negative"`, `"mixed"`, or `"empty"`
    - `"empty"` when input is empty
    - `"all_positive"` when all numbers are positive (> 0)
    - `"all_negative"` when all numbers are negative (< 0)
    - `"mixed"` otherwise (including when zeros are present)
- **Output**: object with:
  - `positives` — array of integers
  - `negatives` — array of integers
  - `zeros` — integer
  - `summary` — enum with values `["all_positive", "all_negative", "mixed", "empty"]`

## Scaffold

A `tailor.config.ts` is provided that references `./resolvers/*.ts`.

## Example

Given input `{ numbers: [3, -1, 0, 5, -2] }`, the resolver should return:

```json
{ "positives": [3, 5], "negatives": [-1, -2], "zeros": 1, "summary": "mixed" }
```

## Reference

Refer to the installed SDK package for resolver definition patterns.
