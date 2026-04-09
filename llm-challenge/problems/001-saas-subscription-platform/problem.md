# SaaS Subscription Management Platform

Build a complete subscription management platform using the `@tailor-platform/sdk`.

Refer to the installed `@tailor-platform/sdk` package for API details.

---

## 1. Models (tailordb/)

### Organization (`tailordb/organization.ts`)

Export: `organization` (named)

| Field               | Kind   | Options                                                                                                      |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| name                | string | required                                                                                                     |
| domain              | string | required, unique                                                                                             |
| plan                | enum   | values: `["FREE", "STARTER", "BUSINESS", "ENTERPRISE"]`                                                      |
| billingAddress      | object | fields: street (string), city (string), state (string), postalCode (string), country (string) - all required |
| orgCode             | string | serial: start 1, 4-digit zero-padded, prefix `ORG-`                                                          |
| contactEmail        | string | required, unique, hook: create normalizes to lowercase (falsy → empty string)                                |
| maxSeats            | int    | hook: create defaults to 5 when nullish                                                                      |
| active              | bool   | required                                                                                                     |
| tags                | string | array, optional                                                                                              |
| createdAt/updatedAt |        | standard timestamp fields                                                                                    |

Type-level options:

- description: any non-empty string
- permission: logged-in users can create/read; ENTERPRISE plan users can update/delete
- gqlPermission: ENTERPRISE has all; logged-in users have read/create

### Subscription (`tailordb/subscription.ts`)

Export: `subscription` (named)

| Field               | Kind  | Options                                                                      |
| ------------------- | ----- | ---------------------------------------------------------------------------- |
| organizationId      | uuid  | relation: n-1 to Organization                                                |
| plan                | enum  | values: `["FREE", "STARTER", "BUSINESS", "ENTERPRISE"]`                      |
| status              | enum  | values: `["TRIAL", "ACTIVE", "PAUSED", "CANCELLED"]`                         |
| startDate           | date  | required                                                                     |
| endDate             | date  | optional, hook: update sets to current date when status is CANCELLED         |
| monthlyRate         | float | validate: must be non-negative (message: "monthlyRate must be non-negative") |
| autoRenew           | bool  | required                                                                     |
| createdAt/updatedAt |       | standard timestamp fields                                                    |

Type-level options:

- indexes: `{ fields: ["organizationId", "status"] }`
- features: `{ aggregation: true }`

### Invoice (`tailordb/invoice.ts`)

Export: `invoice` (named)

| Field               | Kind     | Options                                               |
| ------------------- | -------- | ----------------------------------------------------- |
| subscriptionId      | uuid     | relation: n-1 to Subscription                         |
| invoiceNumber       | string   | serial: start 1, 6-digit zero-padded, prefix `INV-`   |
| amount              | float    | required                                              |
| currency            | enum     | values: `["USD", "EUR", "JPY"]`                       |
| issuedAt            | datetime | hook: create sets to current timestamp                |
| dueDate             | date     | required                                              |
| paid                | bool     | optional, hook: create defaults to false when nullish |
| notes               | string   | optional                                              |
| createdAt/updatedAt |          | standard timestamp fields                             |

### UsageRecord (`tailordb/usageRecord.ts`)

Export: `usageRecord` (named)

| Field               | Kind     | Options                                                                    |
| ------------------- | -------- | -------------------------------------------------------------------------- |
| subscriptionId      | uuid     | relation: n-1 to Subscription                                              |
| metric              | string   | required                                                                   |
| quantity            | float    | validate: must be strictly positive (message: "quantity must be positive") |
| recordedAt          | datetime | hook: create sets to current timestamp                                     |
| description         | string   | optional                                                                   |
| createdAt/updatedAt |          | standard timestamp fields                                                  |

### AuditEvent (`tailordb/auditEvent.ts`)

Export: `auditEvent` (named)

**Note**: Only `createdAt` (no `updatedAt`). Define `createdAt` manually as datetime with create hook.

| Field          | Kind     | Options                                                                                 |
| -------------- | -------- | --------------------------------------------------------------------------------------- |
| organizationId | uuid     | relation: n-1 to Organization                                                           |
| action         | enum     | values: `["CREATE", "UPDATE", "DELETE", "LOGIN", "EXPORT"]`                             |
| actor          | string   | required                                                                                |
| target         | string   | optional                                                                                |
| metadata       | object   | fields: ip (string, required), userAgent (string, optional), requestId (uuid, required) |
| occurredAt     | datetime | hook: create sets to current timestamp                                                  |
| tags           | string   | array, optional                                                                         |
| createdAt      | datetime | hook: create sets to current timestamp                                                  |

---

## 2. Resolvers (resolvers/)

### upgradeSubscription (`resolvers/upgradeSubscription.ts`)

Default export a resolver created with `createResolver`.

- **name**: `"upgradeSubscription"`
- **operation**: `"mutation"`
- **input**: `subscriptionId` (uuid), `targetPlan` (enum: FREE/STARTER/BUSINESS/ENTERPRISE), `effectiveDate` (date)
- **output**: `success` (bool), `previousPlan` (string, optional), `newPlan` (string, optional), `proratedAmount` (float, optional), `effectiveDate` (date, optional), `error` (string, optional)

**Business logic**:

- Query subscription by ID. Not found → `{ success: false, error: "Subscription not found" }`
- Status not ACTIVE → `{ success: false, error: "Subscription is not active" }`
- Plan hierarchy: FREE < STARTER < BUSINESS < ENTERPRISE. Not upgrading → `{ success: false, error: "Can only upgrade to a higher plan" }`
- Rates: FREE=0, STARTER=29.99, BUSINESS=99.99, ENTERPRISE=299.99
- Success → `{ success: true, previousPlan, newPlan: targetPlan, proratedAmount: newRate, effectiveDate }`

---

## 3. Executors (executors/)

### invoiceCreated (`executors/invoiceCreated.ts`)

Default export with `createExecutor`.

- **name**: `"invoice-created"`
- **trigger**: `recordCreatedTrigger` on `invoice`, condition: amount > 0
- **operation**: webhook
  - url: `"https://billing.example.com/webhooks/invoice"`
  - headers: `{ "Content-Type": "application/json", Authorization: { vault: "billing-service", key: "BILLING_API_KEY" } }`

### subscriptionPlanChanged (`executors/subscriptionPlanChanged.ts`)

Default export with `createExecutor`.

- **name**: `"subscription-plan-changed"`
- **trigger**: `recordUpdatedTrigger` on `subscription`, condition: plan field changed
- **operation**: graphql
  - query: any string containing `"mutation"`
  - variables: maps newRecord to `{ input: { subscriptionId: newRecord.id, newPlan: newRecord.plan } }`

### upgradeAuditLog (`executors/upgradeAuditLog.ts`)

Default export with `createExecutor`.

- **name**: `"upgrade-audit-log"`
- **trigger**: `resolverExecutedTrigger` on `upgradeSubscription` resolver (import it), condition: successful
- **operation**: graphql mutation to create AuditEvent

### monthlyBillingCycle (`executors/monthlyBillingCycle.ts`)

Default export with `createExecutor`.

- **name**: `"monthly-billing-cycle"`
- **trigger**: `scheduleTrigger`, cron `"0 0 1 * *"`, timezone `"UTC"`
- **operation**: workflow
  - workflow: import from `"../workflows/billingCycle"`
  - args: returns valid ProcessBillingInput
  - authInvoker: `{ namespace: "saas-auth", machineUserName: "BILLING_WORKER" }`

---

## 4. Workflows (workflows/)

### billingCycle (`workflows/billingCycle.ts`)

3 jobs in a single file using `createWorkflow` and `createWorkflowJob`.

**collectUsage** (`"collect-usage"`):

- Input: `{ organizationId: string, billingPeriod: { start: string, end: string } }`
- Output: `{ usageItems: Array<{ metric: string, totalQuantity: number }>, totalItems: number }`
- Returns mock data with 2+ usage items

**calculateCharges** (`"calculate-charges"`):

- Input: `{ usageItems: Array<{ metric: string, totalQuantity: number }>, plan: string, monthlyRate: number }`
- Output: `{ baseCharge: number, overageCharge: number, totalCharge: number }`
- baseCharge = monthlyRate
- Overage thresholds: FREE=100, STARTER=1000, BUSINESS=10000, ENTERPRISE=unlimited
- overageCharge = sum of max(0, totalQuantity - threshold) \* 0.01
- totalCharge = baseCharge + overageCharge

**processBilling** (`"process-billing"`, main job):

- Input: `{ organizationId: string, plan: string, monthlyRate: number, billingPeriod: { start: string, end: string } }`
- Orchestrates: collectUsage → calculateCharges
- Returns `{ success: true, organizationId, totalCharge, usageSummary: { items, totalItems }, billingPeriod }`

**Exports**: default = workflow (`"billing-cycle"`), named = all 3 jobs

---

## 5. Config (`tailor.config.ts`)

- **name**: `"saas-platform"`
- **CORS**: `[dashboard.url]`
- **db.tailordb**: `{ files: ["./tailordb/*.ts"] }`
- **resolver**: `{ "saas-resolver": { files: ["./resolvers/*.ts"] } }`
- **executor**: `{ files: ["./executors/*.ts"] }`
- **workflow**: `{ files: ["./workflows/**/*.ts"] }`
- **auth**:
  - userProfile: type = any tailordb model, usernameField = `"contactEmail"`, attributes: `{ plan: true }`
  - machineUsers: `BILLING_WORKER` (plan: STARTER), `ADMIN_SERVICE` (plan: ENTERPRISE), `ANALYTICS` (plan: FREE)
  - oauth2Clients: `"dashboard-client"` with 2 redirect URIs using dashboard.url (callback paths), `"api-client"` with `["https://api.example.com/callback"]`
  - idProvider: `idp.provider(...)`
- **idp**: password policy: uppercase, lowercase, numeric, non-alphanumeric required; min 10, max 256
- **staticWebsites**: 1 website named `"dashboard"`
- **idp array**: `[idp]`

**Generators** (named export): `defineGenerators` with `@tailor-platform/kysely-type` (output `./generated/tailordb.ts`) and `@tailor-platform/seed` (output `./seed`, machine user `"ADMIN_SERVICE"`).
