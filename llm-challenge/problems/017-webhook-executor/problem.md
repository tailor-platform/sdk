# 017: Incoming Webhook Executor

## Goal

Create an executor that handles incoming webhook requests for payment notifications.

## Instructions

Create the file `executors/paymentWebhook.ts` with a **default export** that defines an executor.

## Requirements

- **Name**: `"payment-webhook"`
- **Description**: `"Handles incoming payment webhook notifications"`
- **Trigger**: An incoming webhook trigger with generic type parameter specifying:
  - `body`: `{ eventType: string; paymentId: string; amount: number; currency: string }`
  - `headers`: `{ "x-webhook-secret": string }`
- **Operation**:
  - Kind: `"function"`
  - Body: An async function that receives the webhook args (`{ body, headers }`) and logs the payment info using `console.log`

## Reference

Refer to the installed SDK package for executor and webhook trigger definition patterns. Note that the generic type must extend `IncomingWebhookRequest` from the SDK.
