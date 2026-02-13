# 035: Resolver Executed Trigger

## Goal

Create an executor that triggers when a specific resolver completes execution.

## Instructions

A resolver `getProduct` is already provided in `resolvers/getProduct/resolver.ts`. It is a query resolver that takes a `productId` string and returns an object with `id` and `name`.

A `tailor.config.ts` is also provided that references the resolver and executor directories.

Create the file `executors/logResolverExecution.ts` with a **default export** that defines an executor triggered when the `getProduct` resolver is executed.

## Requirements

- **Name**: `"log-resolver-execution"`
- **Description**: A non-empty string describing the executor
- **Trigger**: Triggered when the `getProduct` resolver is executed (use `resolverExecutedTrigger`)
- **Operation**:
  - Kind: `"function"`
  - Body: An async function that receives args and logs success/failure information using `console.log`
    - If `args.success` is true, log the result
    - If `args.success` is false, log the error
- Import the `getProduct` resolver from `../resolvers/getProduct/resolver`

## Reference

Refer to the installed SDK package for executor definition patterns.
