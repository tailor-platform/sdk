# Project Management System

Build a project management system with 5 TailorDB models using the `@tailor-platform/sdk`.

{{API_INSTRUCTION}}

---

## 1. Models (tailordb/)

### Team (`tailordb/team.ts`)

Export: `team` (named)

| Field               | Kind   | Options                                                                        |
| ------------------- | ------ | ------------------------------------------------------------------------------ |
| name                | string | required, unique                                                               |
| code                | string | serial: start 1, 3-digit zero-padded, prefix `TEAM-`                           |
| description         | string | optional                                                                       |
| maxMembers          | int    | optional, validate: must be positive, hook: create defaults to 10 when nullish |
| isActive            | bool   | optional, hook: create defaults to true when nullish                           |
| createdAt/updatedAt |        | use `...{{TIMESTAMPS_FN}}`                                                     |

Type-level options:

- description: any non-empty string
- permission: logged-in users can create/read; ADMIN role users can update/delete

### Member (`tailordb/member.ts`)

Export: `member` (named)

| Field               | Kind     | Options                                                                                                                                                  |
| ------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| name                | string   | required                                                                                                                                                 |
| email               | string   | unique, hooks: create and update normalize to lowercase (falsy → empty string)                                                                           |
| role                | enum     | 4 values with descriptions: OWNER ("Team owner with full control"), ADMIN ("Administrator"), MEMBER ("Regular team member"), VIEWER ("Read-only access") |
| teamId              | uuid     | relation: n-1 to Team                                                                                                                                    |
| joinedAt            | datetime | optional, hook: create sets to current timestamp                                                                                                         |
| skills              | string   | array, optional                                                                                                                                          |
| createdAt/updatedAt |          | use `...{{TIMESTAMPS_FN}}`                                                                                                                               |

### Project (`tailordb/project.ts`)

Export: `project` (named)

| Field               | Kind   | Options                                                                                 |
| ------------------- | ------ | --------------------------------------------------------------------------------------- |
| name                | string | required                                                                                |
| code                | string | serial: start 1, 4-digit zero-padded, prefix `PRJ-`                                     |
| description         | string | optional                                                                                |
| status              | enum   | values: PLANNING, ACTIVE, ON_HOLD, COMPLETED, ARCHIVED                                  |
| teamId              | uuid   | relation: n-1 to Team                                                                   |
| priority            | enum   | values: LOW, MEDIUM, HIGH, CRITICAL                                                     |
| budget              | float  | optional, validate: must be non-negative                                                |
| startDate           | date   | required                                                                                |
| endDate             | date   | optional                                                                                |
| settings            | object | fields: isPublic (bool), allowExternalAccess (bool), defaultAssignee (string, optional) |
| tags                | string | array, optional                                                                         |
| createdAt/updatedAt |        | use `...{{TIMESTAMPS_FN}}`                                                              |

Type-level options:

- composite index on teamId and status
- enable aggregation feature

### Task (`tailordb/task.ts`)

Export: `task` (named)

| Field               | Kind     | Options                                                                                   |
| ------------------- | -------- | ----------------------------------------------------------------------------------------- |
| title               | string   | required                                                                                  |
| taskNumber          | int      | serial: start 1 (no format string)                                                        |
| projectId           | uuid     | relation: n-1 to Project                                                                  |
| assigneeId          | uuid     | optional, field-level index, relation: n-1 to Member                                      |
| status              | enum     | values: TODO, IN_PROGRESS, IN_REVIEW, DONE                                                |
| priority            | enum     | values: LOW, MEDIUM, HIGH, CRITICAL                                                       |
| estimatedHours      | float    | optional, validate: must be positive                                                      |
| parentTaskId        | uuid     | optional, self-referencing relation (n-1)                                                 |
| dueDate             | date     | optional                                                                                  |
| completedAt         | datetime | optional, hook: update sets to current timestamp when status is DONE, preserves otherwise |
| createdAt/updatedAt |          | use `...{{TIMESTAMPS_FN}}`                                                                |

Type-level options:

- composite index on projectId and status

### ActivityLog (`tailordb/activityLog.ts`)

Export: `activityLog` (named)

**Note**: Append-only log. Only `createdAt` (no `updatedAt`). Do NOT use `{{TIMESTAMPS_FN}}`.

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
- **staticWebsites**: 1 website named "dashboard", description "Project management dashboard"
- **auth**:
  - userProfile: member type, email as username field, role as attribute
  - machineUsers: SYSTEM_WORKER (role: ADMIN), ADMIN_SERVICE (role: OWNER)
  - oauth2Clients: "dashboard-client" with redirect URI to dashboard callback path, grant types: authorization_code and refresh_token
  - idProvider: provider name "project-provider", client "default-idp-client"
- **idp** (named "project-idp"):
  - authorization: loggedIn, clients: default-idp-client
  - password policy: min 8, max 128, all character types required
- **generators** (named export): kysely-type (output `./generated/tailordb.ts`) and seed (output `./seed`, machine user ADMIN_SERVICE)
