# SaaS Subscription Management Platform

Build a complete subscription management platform using the `@tailor-platform/sdk`.

**Important**: Use the `db.type()` fluent API and `db.fields.timestamps()` for all model definitions (NOT `createType`). Refer to the installed `@tailor-platform/sdk` package for API details.

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
| orgCode             | string | serial: start at 1, format as ORG-0001, ORG-0002, etc. (4-digit zero-padded)                                 |
| contactEmail        | string | required, unique, hook: create normalizes to lowercase (return empty string for falsy input)                 |
| maxSeats            | int    | hook: create defaults to 5 when value is nullish                                                             |
| active              | bool   | required                                                                                                     |
| tags                | string | array: true, optional                                                                                        |
| createdAt/updatedAt |        | use `...db.fields.timestamps()`                                                                              |

Type-level options:

- description: any non-empty string
- permission: logged-in users can create and read; only ENTERPRISE plan users can update and delete
- gqlPermission: ENTERPRISE plan has all permissions; logged-in users have read and create permissions

### Subscription (`tailordb/subscription.ts`)

Export: `subscription` (named)

| Field               | Kind  | Options                                                                                               |
| ------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| organizationId      | uuid  | relation: n-1 to Organization                                                                         |
| plan                | enum  | values: `["FREE", "STARTER", "BUSINESS", "ENTERPRISE"]`                                               |
| status              | enum  | values: `["TRIAL", "ACTIVE", "PAUSED", "CANCELLED"]`                                                  |
| startDate           | date  | required                                                                                              |
| endDate             | date  | optional, hook: update auto-sets to current date when status is CANCELLED (preserves value otherwise) |
| monthlyRate         | float | validate: must be non-negative (message: "monthlyRate must be non-negative")                          |
| autoRenew           | bool  | required                                                                                              |
| createdAt/updatedAt |       | use `...db.fields.timestamps()`                                                                       |

Type-level options:

- indexes: `{ fields: ["organizationId", "status"] }`
- features: `{ aggregation: true }`

### Invoice (`tailordb/invoice.ts`)

Export: `invoice` (named)

| Field               | Kind     | Options                                                                          |
| ------------------- | -------- | -------------------------------------------------------------------------------- |
| subscriptionId      | uuid     | relation: n-1 to Subscription                                                    |
| invoiceNumber       | string   | serial: start at 1, format as INV-000001, INV-000002, etc. (6-digit zero-padded) |
| amount              | float    | required                                                                         |
| currency            | enum     | values: `["USD", "EUR", "JPY"]`                                                  |
| issuedAt            | datetime | hook: create sets to current timestamp                                           |
| dueDate             | date     | required                                                                         |
| paid                | bool     | optional, hook: create defaults to false when value is nullish                   |
| notes               | string   | optional                                                                         |
| createdAt/updatedAt |          | use `...db.fields.timestamps()`                                                  |

### UsageRecord (`tailordb/usageRecord.ts`)

Export: `usageRecord` (named)

| Field               | Kind     | Options                                                                    |
| ------------------- | -------- | -------------------------------------------------------------------------- |
| subscriptionId      | uuid     | relation: n-1 to Subscription                                              |
| metric              | string   | required                                                                   |
| quantity            | float    | validate: must be strictly positive (message: "quantity must be positive") |
| recordedAt          | datetime | hook: create sets to current timestamp                                     |
| description         | string   | optional                                                                   |
| createdAt/updatedAt |          | use `...db.fields.timestamps()`                                            |

### AuditEvent (`tailordb/auditEvent.ts`)

Export: `auditEvent` (named)

**Note**: This model only has `createdAt` (no `updatedAt`). Do NOT use `db.fields.timestamps()` - define `createdAt` manually as a datetime field with a create hook setting it to the current timestamp.

| Field          | Kind     | Options                                                                                 |
| -------------- | -------- | --------------------------------------------------------------------------------------- |
| organizationId | uuid     | relation: n-1 to Organization                                                           |
| action         | enum     | values: `["CREATE", "UPDATE", "DELETE", "LOGIN", "EXPORT"]`                             |
| actor          | string   | required                                                                                |
| target         | string   | optional                                                                                |
| metadata       | object   | fields: ip (string, required), userAgent (string, optional), requestId (uuid, required) |
| occurredAt     | datetime | hook: create sets to current timestamp                                                  |
| tags           | string   | array: true, optional                                                                   |
| createdAt      | datetime | hook: create sets to current timestamp                                                  |

---

## 2. Resolvers (resolvers/)

### upgradeSubscription (`resolvers/upgradeSubscription.ts`)

Default export a resolver created with `createResolver`.

- **name**: `"upgradeSubscription"`
- **operation**: `"mutation"`
- **input**: `subscriptionId` (uuid), `targetPlan` (enum: FREE/STARTER/BUSINESS/ENTERPRISE), `effectiveDate` (date)
- **output** (as `t.object`): `success` (bool), `previousPlan` (string, optional), `newPlan` (string, optional), `proratedAmount` (float, optional), `effectiveDate` (date, optional), `error` (string, optional)

**Business logic** (in body, uses `getDB`):

1. Query the subscription by ID using `getDB("tailordb")` from `"../generated/tailordb"`.
2. If no subscription found, return `{ success: false, error: "Subscription not found" }`
3. If subscription status is not `"ACTIVE"`, return `{ success: false, error: "Subscription is not active" }`
4. Enforce strict plan hierarchy: FREE < STARTER < BUSINESS < ENTERPRISE. If targetPlan is not strictly higher than the current plan, return `{ success: false, error: "Can only upgrade to a higher plan" }`
5. Look up the new monthly rate: FREE=0, STARTER=29.99, BUSINESS=99.99, ENTERPRISE=299.99
6. Return `{ success: true, previousPlan: current plan, newPlan: targetPlan, proratedAmount: new rate, effectiveDate: input.effectiveDate }`

### usageSummary (`resolvers/usageSummary.ts`)

**This resolver is NOT part of the challenge** - it is provided for context only. Do NOT create this file.

---

## 3. Executors (executors/)

### invoiceCreated (`executors/invoiceCreated.ts`)

Default export an executor created with `createExecutor`.

- **name**: `"invoice-created"`
- **description**: any non-empty string
- **trigger**: `recordCreatedTrigger` on `invoice` type
  - condition: fires only when the new record's amount is strictly greater than 0
- **operation**: webhook
  - url: `() => "https://billing.example.com/webhooks/invoice"`
  - headers: `{ "Content-Type": "application/json", Authorization: { vault: "billing-service", key: "BILLING_API_KEY" } }`

### subscriptionPlanChanged (`executors/subscriptionPlanChanged.ts`)

Default export an executor created with `createExecutor`.

- **name**: `"subscription-plan-changed"`
- **description**: any non-empty string
- **trigger**: `recordUpdatedTrigger` on `subscription` type
  - condition: fires only when the plan field value has changed
- **operation**: graphql
  - query: any non-empty string containing `"mutation"`
  - variables: a function that receives the new record and returns `{ input: { subscriptionId: newRecord.id, newPlan: newRecord.plan } }`

### upgradeAuditLog (`executors/upgradeAuditLog.ts`)

Default export an executor created with `createExecutor`.

- **name**: `"upgrade-audit-log"`
- **description**: any non-empty string describing audit logging for subscription upgrades
- **trigger**: `resolverExecutedTrigger` on the `upgradeSubscription` resolver (import it)
  - condition: fires only when the resolver execution was successful
- **operation**: graphql
  - query: a mutation that creates an AuditEvent record
  - variables: a function that maps resolver args to audit event input (action, actor from user, target from result)

### monthlyBillingCycle (`executors/monthlyBillingCycle.ts`)

Default export an executor created with `createExecutor`.

- **name**: `"monthly-billing-cycle"`
- **description**: any non-empty string
- **trigger**: `scheduleTrigger` with cron `"0 0 1 * *"` and timezone `"UTC"`
- **operation**: workflow
  - workflow: import the default export from `"../workflows/billingCycle"`
  - args: a function returning a valid ProcessBillingInput (the main job's input type)
  - authInvoker: `{ namespace: "saas-auth", machineUserName: "BILLING_WORKER" }`

---

## 4. Workflows (workflows/)

### billingCycle (`workflows/billingCycle.ts`)

Create a workflow with 3 jobs all in a single file. Use `createWorkflow` and `createWorkflowJob`.

**collectUsage** job:

- name: `"collect-usage"`
- body: takes `{ organizationId: string, billingPeriod: { start: string, end: string } }`
- returns: `{ usageItems: Array<{ metric: string, totalQuantity: number }>, totalItems: number }`
- Logic: return mock usage data with at least 2 usage items and a totalItems count

**calculateCharges** job:

- name: `"calculate-charges"`
- body: takes `{ usageItems: Array<{ metric: string, totalQuantity: number }>, plan: string, monthlyRate: number }`
- returns: `{ baseCharge: number, overageCharge: number, totalCharge: number }`
- Logic:
  - baseCharge = monthlyRate
  - Overage thresholds per plan: FREE=100, STARTER=1000, BUSINESS=10000. ENTERPRISE plans have no usage limits
  - overageCharge = sum of each usage item: if totalQuantity > threshold, charge (totalQuantity - threshold) \* 0.01; else 0
  - totalCharge = baseCharge + overageCharge

**processBilling** job (main job):

- name: `"process-billing"`
- body: async, takes `{ organizationId: string, plan: string, monthlyRate: number, billingPeriod: { start: string, end: string } }`
- Orchestrates: `await collectUsage.trigger(...)` then `await calculateCharges.trigger(...)`
- returns: `{ success: true, organizationId, totalCharge, usageSummary: { items: usageResult.usageItems, totalItems: usageResult.totalItems }, billingPeriod }`

**Workflow**:

- `createWorkflow({ name: "billing-cycle", mainJob: processBilling })`
- Default export: the workflow
- Named exports: `collectUsage`, `calculateCharges`, `processBilling`

---

## 5. Config (`tailor.config.ts`)

Replace the scaffold with a full configuration.

- **name**: `"saas-platform"`
- **CORS**: `[dashboard.url]` (using the static website reference)
- **db.tailordb**: `{ files: ["./tailordb/*.ts"] }`
- **resolver**: `{ "saas-resolver": { files: ["./resolvers/*.ts"] } }`
- **executor**: `{ files: ["./executors/*.ts"] }`
- **workflow**: `{ files: ["./workflows/**/*.ts"] }`
- **auth** (via `defineAuth`):
  - userProfile: type = any tailordb model (e.g., organization), usernameField = `"contactEmail"`, attributes: `{ plan: true }`
  - machineUsers: `BILLING_WORKER` (attributes: `{ plan: "STARTER" }`), `ADMIN_SERVICE` (attributes: `{ plan: "ENTERPRISE" }`), `ANALYTICS` (attributes: `{ plan: "FREE" }`)
  - oauth2Clients: `"dashboard-client"` with redirectURIs using dashboard.url (2 URIs: callback and auth/callback paths), and `"api-client"` with redirectURIs `["https://api.example.com/callback"]`
  - idProvider: use idp.provider(...)
- **idp** (via `defineIdp`):
  - userAuthPolicy: require uppercase, lowercase, numeric, non-alphanumeric; min length 10, max 256
- **staticWebsites**: 1 website named `"dashboard"`
- **idp array**: `[idp]`

**Generators** (named export): Use `defineGenerators` with `@tailor-platform/kysely-type` (output to `./generated/tailordb.ts`) and `@tailor-platform/seed` (output to `./seed`, machine user `"ADMIN_SERVICE"`).
