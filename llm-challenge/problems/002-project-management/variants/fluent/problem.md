# Project Management System

Build a project management system with 5 TailorDB models using the `@tailor-platform/sdk`.

**Important**: Use the `db.type()` fluent API and `db.fields.timestamps()` for all model definitions (NOT `createType`). Refer to the installed `@tailor-platform/sdk` package for API details.

---

## 1. Models (tailordb/)

### Team (`tailordb/team.ts`)

Export: `team` (named)

| Field               | Kind   | Options                                                                                                                                                                     |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| name                | string | required, unique                                                                                                                                                            |
| code                | string | auto-generated serial code starting at 1, formatted as TEAM-001, TEAM-002, etc. (3-digit zero-padded)                                                                       |
| description         | string | optional                                                                                                                                                                    |
| maxMembers          | int    | optional, validate: must be positive (zero is not a valid member count), hook: create defaults to 10 (use nullish coalescing to preserve explicit 0 and other falsy values) |
| isActive            | bool   | optional, hook: create defaults to true (use nullish coalescing to preserve explicit false)                                                                                 |
| createdAt/updatedAt |        | use `...db.fields.timestamps()`                                                                                                                                             |

Type-level (chained): description (any non-empty string), permission (logged-in users can create and read; only users with "ADMIN" role can update and delete), hooks for maxMembers and isActive, validation for maxMembers.

### Member (`tailordb/member.ts`)

Export: `member` (named)

| Field               | Kind     | Options                                                                                                                                                         |
| ------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| name                | string   | required                                                                                                                                                        |
| email               | string   | unique, hooks: create and update both normalize the value to lowercase (return empty string for falsy input)                                                    |
| role                | enum     | 4 values, each with a description: OWNER ("Team owner with full control"), ADMIN ("Administrator"), MEMBER ("Regular team member"), VIEWER ("Read-only access") |
| teamId              | uuid     | relation: n-1 to Team                                                                                                                                           |
| joinedAt            | datetime | optional, hook: create sets to current timestamp                                                                                                                |
| skills              | string   | array, optional                                                                                                                                                 |
| createdAt/updatedAt |          | use `...db.fields.timestamps()`                                                                                                                                 |

Type-level (chained): hooks for email (create and update) and joinedAt (create).

### Project (`tailordb/project.ts`)

Export: `project` (named)

| Field               | Kind   | Options                                                                                               |
| ------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| name                | string | required                                                                                              |
| code                | string | auto-generated serial code starting at 1, formatted as PRJ-0001, PRJ-0002, etc. (4-digit zero-padded) |
| description         | string | optional                                                                                              |
| status              | enum   | values: PLANNING, ACTIVE, ON_HOLD, COMPLETED, ARCHIVED                                                |
| teamId              | uuid   | relation: n-1 to Team                                                                                 |
| priority            | enum   | values: LOW, MEDIUM, HIGH, CRITICAL                                                                   |
| budget              | float  | optional, validate: must be non-negative (zero is a valid budget)                                     |
| startDate           | date   | required                                                                                              |
| endDate             | date   | optional                                                                                              |
| settings            | object | fields: isPublic (bool), allowExternalAccess (bool), defaultAssignee (string, optional)               |
| tags                | string | array, optional                                                                                       |
| createdAt/updatedAt |        | use `...db.fields.timestamps()`                                                                       |

Type-level (chained): validation for budget, composite index on teamId and status, enable aggregation feature.

### Task (`tailordb/task.ts`)

Export: `task` (named)

| Field               | Kind     | Options                                                                                                                                                                 |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| title               | string   | required                                                                                                                                                                |
| taskNumber          | int      | auto-generated serial number starting at 1 (no format string, just the integer)                                                                                         |
| projectId           | uuid     | relation: n-1 to Project                                                                                                                                                |
| assigneeId          | uuid     | optional, field-level index, relation: n-1 to Member                                                                                                                    |
| status              | enum     | values: TODO, IN_PROGRESS, IN_REVIEW, DONE                                                                                                                              |
| priority            | enum     | values: LOW, MEDIUM, HIGH, CRITICAL                                                                                                                                     |
| estimatedHours      | float    | optional, validate: must be positive (zero is not a valid estimate)                                                                                                     |
| parentTaskId        | uuid     | optional, self-referencing relation (n-1 to itself)                                                                                                                     |
| dueDate             | date     | optional                                                                                                                                                                |
| completedAt         | datetime | optional, hook: update automatically records completion timestamp when task status becomes "DONE"; for any other status, the existing value must be preserved unchanged |
| createdAt/updatedAt |          | use `...db.fields.timestamps()`                                                                                                                                         |

Type-level (chained): hooks for completedAt (update), validation for estimatedHours, composite index on projectId and status.

### ActivityLog (`tailordb/activityLog.ts`)

Export: `activityLog` (named)

**Note**: This is an append-only audit log. Records are created but never updated. Define only `createdAt` as the sole timestamp field (do NOT use `db.fields.timestamps()`).

| Field     | Kind     | Options                                                                                           |
| --------- | -------- | ------------------------------------------------------------------------------------------------- |
| taskId    | uuid     | relation: n-1 to Task                                                                             |
| actorId   | uuid     | relation: n-1 to Member                                                                           |
| action    | enum     | values: CREATED, UPDATED, COMMENTED, STATUS_CHANGED, ASSIGNED                                     |
| detail    | object   | fields: previousValue (string, optional), newValue (string, optional), comment (string, optional) |
| createdAt | datetime | optional, hook: create sets to current timestamp, description: "Record creation timestamp"        |

---

## 2. Configuration (`tailor.config.ts`)

- **name**: "project-mgmt"
- **CORS**: dashboard URL
- **db**: tailordb files from `./tailordb/*.ts`
- **staticWebsites**: 1 dashboard website named "dashboard" with description "Project management dashboard"
- **auth**:
  - userProfile: uses member type, email as username field, role as attribute
  - machineUsers: two machine users -- SYSTEM_WORKER with administrator privileges, ADMIN_SERVICE with owner-level privileges
  - oauth2Clients: "dashboard-client" with redirect URI to dashboard callback path, grant types: authorization_code and refresh_token
  - idProvider: configured with project-provider name and default-idp-client
- **idp** (named "project-idp"):
  - authorization: loggedIn, clients: default-idp-client
  - password policy: min 8, max 128 characters, all character type requirements enabled (uppercase, lowercase, numeric, non-alphanumeric)
- **generators** (named export): kysely-type generator (output to ./generated/tailordb.ts) and seed generator (output to ./seed, using ADMIN_SERVICE machine user)
