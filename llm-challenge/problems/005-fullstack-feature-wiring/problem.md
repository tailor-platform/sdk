# Full-Stack Feature Wiring

## Overview

Build a complete user registration and onboarding feature using the Tailor Platform SDK. This problem tests your ability to wire together all SDK primitives -- models with permissions, resolvers with database queries, executors with webhook operations, workflows with multi-job orchestration, and a full application configuration with authentication, identity provider, static website, and code generators.

## Scaffold

You are given:

- `tailor.config.ts` -- A minimal configuration stub that needs to be expanded into a full application config

## Files to Implement

### 1. `tailordb/registration.ts`

Define a `Registration` model with permissions, indexes, and aggregation.

**Fields:**

| Field          | Type   | Required | Notes                                                    |
| -------------- | ------ | -------- | -------------------------------------------------------- |
| `email`        | string | Yes      | Must be unique (`.unique()`)                             |
| `name`         | string | Yes      |                                                          |
| `plan`         | enum   | Yes      | Values: `"free"`, `"basic"`, `"premium"`, `"enterprise"` |
| `role`         | enum   | Yes      | Values: `"user"`, `"admin"` (used for auth attributes)   |
| `userId`       | uuid   | No       |                                                          |
| `status`       | enum   | Yes      | Values: `"pending"`, `"active"`, `"suspended"`           |
| `referralCode` | string | No       |                                                          |

- Include timestamps (`createdAt`, `updatedAt`) using `db.fields.timestamps()`
- Named export: `registration`
- Type export: `type registration = typeof registration`
- Type name: `"Registration"`

**Indexes (at least 2):**

1. First index must contain `email` and be unique, e.g. `{ fields: ["email", "status"], unique: true }`
2. `{ fields: ["status", "plan"], unique: false }`

**Features:** Enable aggregation (`{ aggregation: true }`)

**Permissions:** Define a `TailorTypePermission` object with all 4 actions:

- `create`: logged-in users
- `read`: logged-in users
- `update`: admin only
- `delete`: admin only

Use `PermissionCondition` with these condition patterns:

- Logged in: `[{ user: "_loggedIn" }, "=", true]`
- Is admin: `[{ user: "role" }, "=", "admin"]`

**GQL Permissions:** Define a `TailorTypeGqlPermission` array with at least 2 entries:

- Admin gets `"all"` actions
- Logged-in users get `["read", "create"]`

### 2. `resolvers/registerUser.ts` (mutation)

A resolver that checks for duplicate emails using `getDB` and triggers an onboarding workflow.

**Name:** `"registerUser"`

**Input:**

- `email`: string (required)
- `name`: string (required)
- `plan`: enum `["free", "basic", "premium", "enterprise"]` (required)
- `referralCode`: string (optional)

**Body (async):**

1. Get a database connection with `getDB("tailordb")` (import from `"../generated/tailordb"`)
2. Query the `"Registration"` table to check if the email already exists (use Kysely's `selectFrom`, `select`, `where`, `executeTakeFirst`)
3. If the email exists, return `{ success: false, message: "Email <email> is already registered" }`
4. Otherwise, trigger the `onboardUser` workflow job (import from `"../workflows/onboardingJobs"`) with the registration data
5. Return `{ success: true, message: "Registration initiated for <email>", workflowRunId: String(workflowRunId) }`

**Output:** `{ success: bool, message: string, workflowRunId?: string }`

**Default export** the resolver.

### 3. `executors/registrationCreated.ts`

An executor that sends a webhook notification when a paid registration is created.

- **Trigger:** `recordCreatedTrigger` on the `registration` type (import from `"../tailordb/registration"`)
- **Condition:** Only fire when `newRecord.plan !== "free"` (i.e., paid plans only)
- **Operation kind:** `webhook`
  - **url:** `` ({ newRecord }) => `https://api.billing.example.com/registrations/${newRecord.id}` ``
  - **headers:**
    - `"Content-Type": "application/json"`
    - `Authorization: { vault: "billing-service", key: "api-key" }`
  - **requestBody:** `({ newRecord }) => ({ email: newRecord.email, name: newRecord.name, plan: newRecord.plan })`
- **name:** `"registration-created"`
- **description:** Non-empty string describing the executor

**Default export** the executor.

### 4. `workflows/onboardingJobs.ts`

Define 3 workflow jobs as named exports. This file contains the job logic but NOT the workflow definition.

#### setupAccount job

**Named export:** `setupAccount`

**Input:** `{ email: string; name: string; plan: string }`

**Output:** `{ accountId: string; email: string; name: string; plan: string }`

- Generate `accountId` as `` `acc-${email.split("@")[0]}` ``

**Job name:** `"setup-account"`

#### assignDefaults job

**Named export:** `assignDefaults`

**Input:** `{ accountId: string; plan: string }`

**Output:** `{ accountId: string; storageQuota: number; apiRateLimit: number }`

- Storage quotas by plan: `free=100`, `basic=1000`, `premium=10000`, `enterprise=100000`. Default to `100` for unknown plans.
- API rate limit: `10000` for enterprise, `1000` for all others

**Job name:** `"assign-defaults"`

#### onboardUser job (main job)

**Named export:** `onboardUser`

**Input:** `{ email: string; name: string; plan: string; referralCode: string }`

**Body (async):** Orchestrates by triggering other jobs in sequence:

1. Trigger `setupAccount` with `{ email, name, plan }`
2. Trigger `assignDefaults` with `{ accountId: account.accountId, plan }`
3. Return combined result: `{ accountId, email, plan, storageQuota, apiRateLimit, referralCode }`

**Job name:** `"onboard-user"`

### 5. `workflows/onboarding.ts`

The workflow definition file. It creates the workflow and re-exports all jobs.

- **Default export:** the workflow created with `createWorkflow`
- **Workflow name:** `"user-onboarding"`
- **Main job:** `onboardUser`
- **Re-exports:** `onboardUser`, `setupAccount`, `assignDefaults` from `"./onboardingJobs"`

### 6. `tailor.config.ts` (overrides scaffold)

Build a complete application configuration that wires everything together.

**Static website:** `defineStaticWebSite("registration-app", { description: "User registration frontend" })`

**IDP:** `defineIdp("registration-idp", ...)` with:

- `authorization: "loggedIn"`
- `clients: ["default-idp-client"]`
- `userAuthPolicy` with password requirements (uppercase, lowercase, non-alphanumeric, numeric, min 8, max 128)

**Auth:** `defineAuth("registration-auth", ...)` with:

- `userProfile`: uses the `registration` type (import from `"./tailordb/registration"`), `usernameField: "email"`, `attributes: { role: true }`
- `machineUsers`: `"system-user"` with `attributes: { role: "admin" }` (must match the model's role enum values)
- `oauth2Clients`: `"registration-client"` with redirect URIs using `website.url` (`/callback` and `/auth/callback`), grant types `["authorization_code", "refresh_token"]`
- `idProvider`: `idp.provider("registration-provider", "default-idp-client")`

**Config (`defineConfig`):**

- `name: "challenge-005"`
- `cors: [website.url]`
- `db: { tailordb: { files: ["./tailordb/*.ts"] } }`
- `resolver: { "my-resolver": { files: ["./resolvers/*.ts"] } }`
- `executor: { files: ["./executors/*.ts"] }`
- `workflow: { files: ["./workflows/**/*.ts"] }`
- `auth`, `idp: [idp]`, `staticWebsites: [website]`

**Generators (named export `generators`):** Use `defineGenerators()` with the `@tailor-platform/kysely-type` generator (distPath: `"./generated/tailordb.ts"`)

## Key Requirements

- The `email` field must be `.unique()` because `defineAuth` requires `usernameField` to reference a unique string field
- The `role` field is needed for auth attribute mapping (`attributes: { role: true }`)
- The `registration` model must have both `permission` and `gqlPermission` defined
- The resolver must use `getDB` to query the database and handle duplicate emails
- The resolver must trigger a workflow job and return the workflow run ID
- The executor must use `recordCreatedTrigger` with a condition filtering out free plans
- Workflow jobs must have unique names and be properly connected via `.trigger()`
- The `onboarding.ts` file must re-export all jobs and have a default-exported workflow
- The config must wire together all services: db, resolver, executor, workflow, auth, idp, static website, and generators
- Import dependencies between files must be correct (resolver imports from workflows, executor imports from tailordb, config imports from tailordb)
- Machine user attribute values must match the model's enum values

## Hints

- Model builder chain: `.type()` → `.indexes()` → `.features()` → `.permission()` → `.gqlPermission()`
- Permission types (`TailorTypePermission`, `TailorTypeGqlPermission`, `PermissionCondition`) are imported from `@tailor-platform/sdk`
- Resolver types (`createResolver`, `t`) and executor/workflow functions are all from `@tailor-platform/sdk`
- `getDB` is imported from the generated file (`"../generated/tailordb"`)
- Config functions: `defineConfig`, `defineAuth`, `defineIdp`, `defineStaticWebSite`, `defineGenerators`
- Refer to `example/` in the SDK repository for working patterns of all components

## Scoring

| Stage     | Points  |
| --------- | ------- |
| generate  | 20      |
| typecheck | 30      |
| tests     | 150     |
| **Total** | **200** |
