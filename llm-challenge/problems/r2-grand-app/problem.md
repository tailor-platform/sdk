# Grand-app: Org / Member platform end-to-end

Build a small but complete Tailor Platform service that exercises the
breadth of `@tailor-platform/sdk`. The repository must typecheck against
the installed SDK and pass the structural tests under `tests/`.

## Domain

A multi-tenant **Organization / Member** management service. Each
`Organization` owns many `Member`s. Members are mirrored from an external
identity provider, and platform admins receive notifications and run a
manual approval workflow when a new organization is provisioned.

## TailorDB models

Create both files. Both TailorDB types must be **named exports** so other
modules can import them.

### `tailordb/organization.ts` — `export const organization`

Define a TailorDB type called `Organization` with the following fields
(TailorDB adds an implicit `id` field automatically — do not declare it):

- `name` — string, **required and unique**.
- `slug` — string, **must satisfy a custom validation rule**: the slug must
  be non-empty and at most 32 characters. The validation error message
  must contain the substring `"slug"`.
- `tier` — string. No constraints.

The type must:

- attach a **type-level update hook** that lowercases the `slug` field
  before write (transforms `data.slug` to its lowercase form during
  update).
- declare a **role-gated permission rule** that grants `read` to any
  logged-in user (`{ user: "_loggedIn" } = true`).

### `tailordb/member.ts` — `export const member`

Define a TailorDB type called `Member` (the implicit `id` field is
added by TailorDB; do not declare it):

- `organizationId` — UUID with a **many-to-one relation** toward the
  `Organization` model imported from `./organization`.
- `email` — string, **required and unique** (so it can be used as the
  auth `usernameField`).
- `role` — string. Used by the auth config below as a user attribute.
- `roles` — **array of strings** (multi-value), used to attach role tags
  to a member.

The type must also declare a **composite index** on the pair
`(organizationId, email)`.

## Resolver

### `resolvers/listOrgMembers.ts`

Default-export a resolver named `"list-org-members"`:

- Operation: `"query"`.
- Input: `{ organizationId: string (UUID) }`.
- Output: an array of objects each shaped
  `{ id: string; email: string; roles: string[] }`.
- The handler body may return an empty array; it does not need to query
  TailorDB. The point is that the resolver definition compiles.

## Executors

Each executor must be in its own file under `executors/` and must be a
default export of an executor created with the SDK's executor factory.
All executors must have a unique `name`.

### `executors/onMemberCreated.ts` — single-event trigger

Trigger: a `Member` record is created. The executor body logs the new
member's email. Use the **single-event record-created trigger**
(the variant that handles exactly one record event).

### `executors/onOrgChanged.ts` — multi-event record trigger

Trigger: an `Organization` record is **created or updated**. Use the
**multi-event record trigger variant** (single executor handling several
record events). Inside the body, `args.event` narrows to `"created"` or
`"updated"`; log a different line per event.

### `executors/onIdpUserSync.ts` — multi-event IdP user trigger

Trigger: an IdP user is **created or updated** on the IdP named
`"my-idp"`. Use the **multi-event IdP user trigger** (single executor
handling multiple IdP user events). The body just logs `args.event`.

### `executors/dailyCleanup.ts` — CRON schedule trigger

Trigger: fires on a CRON schedule `"0 3 * * *"` in timezone `"Asia/Tokyo"`.
The body logs `"daily cleanup"`.

### `executors/externalSync.ts` — incoming webhook trigger

Trigger: an incoming webhook. The webhook body type is
`{ payload: string }`. The body logs `args.body.payload`. The webhook
response must return `{ ok: true }`.

## Workflow

### `workflows/onboarding.ts`

Build a single-file workflow that the platform team triggers when a new
organization is created. The file must:

1. Declare a **typed wait/resolve point** named `adminApproval` with
   payload `{ organizationId: string }` and resolution `{ approved: boolean }`.
2. Define a named-export child job called `loadOrganization` that takes
   `{ organizationId: string }` and reads the organization name by
   acquiring a **Kysely DB handle** for the `"tailordb"` namespace and
   running `selectFrom("Organization").select(["name"]).where("id", "=", organizationId).executeTakeFirstOrThrow()`.
   It returns `{ name: row.name }`.
3. Define a named-export main job called `provisionOrg` that:
   - Calls `loadOrganization` via its `.trigger({ organizationId })`
     method (**must be `await`ed**).
   - Suspends on the `adminApproval` wait point, passing the
     `organizationId` it received as input.
   - Returns `{ organizationId, name, approved }`.
4. Default-export the workflow with `name: "onboarding"` and `mainJob:
provisionOrg`.

The Kysely DB handle is provided by the generator that emits
`./generated/tailordb.ts`. Import `getDB` from
`./generated/tailordb` and call it with the `"tailordb"` namespace.
You may assume the generator has already produced this file.

## `tailor.config.ts`

The scaffold ships a near-empty `tailor.config.ts`. Replace it with a
file that:

- Imports the two TailorDB models from `./tailordb/organization` and
  `./tailordb/member` (so they participate in the schema).
- Declares a **static website** named `"frontend"` with description
  `"Org platform frontend"`. It must be assigned to a `const` named
  `website` so its `.url` can be referenced from `cors`.
- Declares an **IdP config** named `"my-idp"`:
  - `clients: ["default-client"]`.
  - A `permission` object with keys `create / read / update / delete /
sendPasswordResetEmail`, each set to
    `[{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }]`.
- Declares an **auth config** named `"my-auth"`:
  - `userProfile.type` is the `Member` model.
  - `userProfile.usernameField` is `"email"`.
  - `userProfile.attributes` exposes `role` (`{ role: true }`).
  - `machineUsers` declares one entry `"default-machine-user"` with
    `attributes: { role: "admin" }`.
  - `idProvider` is `idp.provider("default-client", "default-client")`.
- Default-exports the top-level project config, with:
  - `name: "r2-grand-app"`.
  - `cors: [website.url]`.
  - `db.tailordb.files: ["./tailordb/*.ts"]`.
  - `resolver: { "my-resolver": { files: ["./resolvers/*.ts"] } }`.
  - `executor: { files: ["./executors/*.ts"] }`.
  - `workflow: { files: ["./workflows/**/*.ts"] }`.
  - `idp: [idp]`.
  - `auth` (the const declared above).
  - `staticWebsites: [website]`.
- Also exposes a named export `plugins` that **registers plugins** for
  the project. At minimum, register the **Kysely-type plugin** with
  `distPath: "./generated/tailordb.ts"` so `getDB(...)` works inside
  workflows.

## Requirements summary

- All files must typecheck against the installed `@tailor-platform/sdk`.
- Default vs named exports must match the spec above
  (e.g. workflows and executors default-export the SDK factory result;
  the workflow's child jobs are named exports).
- `tailor.config.ts` exports the top-level project config as **default
  export** and the plugin registration as a **named export `plugins`**.
- Use only SDK factories and chain methods exported from
  `@tailor-platform/sdk` and `@tailor-platform/sdk/plugin/kysely-type`.
  Do not invent helper wrappers.

## Reference

Refer to the installed SDK package and the surrounding files for the
factory names. No external documentation is required.
