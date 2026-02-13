# 040: Webhook Executor with Vault Secret

## Goal

Create an executor with a webhook operation that uses a vault secret for the Authorization header.

## Instructions

An `Order` model is already provided in `tailordb/order.ts`. Create the file `executors/notifyExternal.ts` that defines an executor which sends a webhook when a new order is created.

The executor should:

- Be named `"notify-external-service"`
- Have a description explaining its purpose
- Trigger on `recordCreated` for the `order` type
- Use a **webhook** operation (not a function operation):
  - `url`: A function that returns `https://api.example.com/orders/${args.newRecord.id}`
  - `requestBody`: A function that returns `{ orderId, customerId, totalAmount }` from the new record
  - `headers`: Include `Content-Type: "application/json"` and an `Authorization` header that uses a **vault secret** (vault: `"api-secrets"`, key: `"external-api-token"`)

## Requirements

- Import the `order` type from the tailordb file
- Use `recordCreatedTrigger` for the trigger
- The Authorization header must use a vault secret object (`{ vault, key }`) instead of a plain string
- The file must have a **default export**

## Reference

Refer to the installed SDK package for executor, webhook operation, and vault secret patterns.
