# 043: Executor with GraphQL Operation and Auth Invoker

## Goal

Create an executor that runs a GraphQL operation with `authInvoker` when a resolver is executed.

## Instructions

A resolver `updateProduct` is already provided in `resolvers/updateProduct/resolver.ts`. It is a mutation that accepts `id`, `name`, and `price` as input and returns `{ id, updated }`.

Create the file `executors/syncData.ts` with a **default export** that defines an executor.

### Executor

- **Name**: `"sync-product-data"`
- **Description**: `"Syncs product data to external system after update"`
- **Trigger**: Triggered when the `updateProduct` resolver is executed
  - Add a condition that only triggers on success: `({ success }) => success`
- **Operation**:
  - Kind: `"graphql"`
  - appName: `"external-sync-app"`
  - query: A GraphQL mutation string that syncs a product. It must contain `syncProduct` in the query text
  - variables: A function that receives the trigger args and returns variables. Check `args.success` and return variables from `args.result` when successful, or an empty object otherwise
  - authInvoker: `{ namespace: "app-auth", machineUserName: "sync-worker" }`

## Requirements

- Import `createExecutor` and `resolverExecutedTrigger` from `@tailor-platform/sdk`
- Import the `updateProduct` resolver from `../resolvers/updateProduct/resolver`
- The trigger must reference the `updateProduct` resolver
- The operation must include `authInvoker` with both `namespace` and `machineUserName`

## Reference

Refer to the installed SDK package for executor and resolver-executed trigger patterns.
