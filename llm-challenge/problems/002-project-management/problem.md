# Project Management System

Build a project management system with 5 TailorDB models using the `@tailor-platform/sdk`.

**Important**: Use the `createType` and `timestampFields` APIs for all model definitions (NOT `db.type()`). Refer to the installed `@tailor-platform/sdk` package for API details.

---

## 1. Models (tailordb/)

### Team (`tailordb/team.ts`)

Export: `team` (named) + `type team = typeof team`

| Field               | Kind   | Options                                                                                                                                           |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| name                | string | required, unique                                                                                                                                  |
| code                | string | serial: `{ start: 1, format: "TEAM-%03d" }`                                                                                                       |
| description         | string | optional                                                                                                                                          |
| maxMembers          | int    | optional, validate: `({ value }) => value > 0` (msg: `"maxMembers must be positive"`), hook: create defaults to 10 (`({ value }) => value ?? 10`) |
| isActive            | bool   | optional, hook: create defaults to true (`({ value }) => value ?? true`)                                                                          |
| createdAt/updatedAt |        | use `...timestampFields()`                                                                                                                        |

Type-level options:

- description: any non-empty string
- permission: `{ create: [[{ user: "_loggedIn" }, "=", true]], read: [[{ user: "_loggedIn" }, "=", true]], update: [[{ user: "role" }, "=", "ADMIN"]], delete: [[{ user: "role" }, "=", "ADMIN"]] }`

### Member (`tailordb/member.ts`)

Export: `member` (named) + type alias

| Field               | Kind     | Options                                                                                                                                                                                                                                                        |
| ------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| name                | string   | required                                                                                                                                                                                                                                                       |
| email               | string   | unique, hook: create lowercases value (`({ value }) => value ? value.toLowerCase() : ""`)                                                                                                                                                                      |
| role                | enum     | values with descriptions: `[{ value: "OWNER", description: "Team owner with full control" }, { value: "ADMIN", description: "Administrator" }, { value: "MEMBER", description: "Regular team member" }, { value: "VIEWER", description: "Read-only access" }]` |
| teamId              | uuid     | relation: n-1 to Team                                                                                                                                                                                                                                          |
| joinedAt            | datetime | optional, hook: create returns `new Date()`                                                                                                                                                                                                                    |
| skills              | string   | array: true, optional                                                                                                                                                                                                                                          |
| createdAt/updatedAt |          | use `...timestampFields()`                                                                                                                                                                                                                                     |

### Project (`tailordb/project.ts`)

Export: `project` (named) + type alias

| Field               | Kind   | Options                                                                                 |
| ------------------- | ------ | --------------------------------------------------------------------------------------- |
| name                | string | required                                                                                |
| code                | string | serial: `{ start: 1, format: "PRJ-%04d" }`                                              |
| description         | string | optional                                                                                |
| status              | enum   | values: `["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]`                    |
| teamId              | uuid   | relation: n-1 to Team                                                                   |
| priority            | enum   | values: `["LOW", "MEDIUM", "HIGH", "CRITICAL"]`                                         |
| budget              | float  | optional, validate: `({ value }) => value >= 0` (msg: `"budget must be non-negative"`)  |
| startDate           | date   | required                                                                                |
| endDate             | date   | optional                                                                                |
| settings            | object | fields: isPublic (bool), allowExternalAccess (bool), defaultAssignee (string, optional) |
| tags                | string | array: true, optional                                                                   |
| createdAt/updatedAt |        | use `...timestampFields()`                                                              |

Type-level options:

- indexes: `[{ fields: ["teamId", "status"] }]`
- features: `{ aggregation: true }`

### Task (`tailordb/task.ts`)

Export: `task` (named) + type alias

| Field               | Kind     | Options                                                                                           |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| title               | string   | required                                                                                          |
| taskNumber          | int      | serial: `{ start: 1 }`                                                                            |
| projectId           | uuid     | relation: n-1 to Project                                                                          |
| assigneeId          | uuid     | optional, index: true, relation: n-1 to Member                                                    |
| status              | enum     | values: `["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]`                                            |
| priority            | enum     | values: `["LOW", "MEDIUM", "HIGH", "CRITICAL"]`                                                   |
| estimatedHours      | float    | optional, validate: `({ value }) => value > 0` (msg: `"estimatedHours must be positive"`)         |
| parentTaskId        | uuid     | optional, self-referencing relation: n-1 to `"self"`                                              |
| dueDate             | date     | optional                                                                                          |
| completedAt         | datetime | optional, hook: update sets `new Date()` when `data.status === "DONE"`, preserves value otherwise |
| createdAt/updatedAt |          | use `...timestampFields()`                                                                        |

Type-level options:

- indexes: `[{ fields: ["projectId", "status"] }]`

### ActivityLog (`tailordb/activityLog.ts`)

Export: `activityLog` (named) + type alias

**Note**: This model only has `createdAt` (no `updatedAt`). Do NOT use `timestampFields()`.

| Field     | Kind     | Options                                                                                           |
| --------- | -------- | ------------------------------------------------------------------------------------------------- |
| taskId    | uuid     | relation: n-1 to Task                                                                             |
| actorId   | uuid     | relation: n-1 to Member                                                                           |
| action    | enum     | values: `["CREATED", "UPDATED", "COMMENTED", "STATUS_CHANGED", "ASSIGNED"]`                       |
| detail    | object   | fields: previousValue (string, optional), newValue (string, optional), comment (string, optional) |
| createdAt | datetime | hook: create returns `new Date()`, description: `"Record creation timestamp"`                     |

---

## 2. Configuration (`tailor.config.ts`)

- **name**: `"project-mgmt"`
- **CORS**: `[dashboard.url]`
- **db**: `{ tailordb: { files: ["./tailordb/*.ts"] } }`
- **staticWebsites**: 1 dashboard website via `defineStaticWebSite("dashboard", { description: "Project management dashboard" })`
- **auth** (via `defineAuth`):
  - userProfile: `{ type: member, usernameField: "email", attributes: { role: true } }`
  - machineUsers: `SYSTEM_WORKER` (role: "ADMIN"), `ADMIN_SERVICE` (role: "OWNER")
  - oauth2Clients: `"dashboard-client"` with `redirectURIs: [\`${dashboard.url}/callback\`]`, grantTypes: `["authorization_code", "refresh_token"]`
  - idProvider: `idp.provider("project-provider", "default-idp-client")`
- **idp** (via `defineIdp("project-idp", ...)`):
  - authorization: `"loggedIn"`, clients: `["default-idp-client"]`
  - userAuthPolicy: passwordMinLength: 8, passwordMaxLength: 128, requireUppercase/Lowercase/Numeric/NonAlphanumeric: true
- **generators** (named export): `defineGenerators(["@tailor-platform/kysely-type", { distPath: "./generated/tailordb.ts" }], ["@tailor-platform/seed", { distPath: "./seed", machineUserName: "ADMIN_SERVICE" }])`
