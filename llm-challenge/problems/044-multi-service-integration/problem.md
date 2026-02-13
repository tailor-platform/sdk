# 044: Multi-Service Integration

## Goal

Create a complete multi-service integration with a model, resolver, executor, and workflow across 4 files.

## Instructions

A `tailor.config.ts` is already provided that references all service directories. You need to create 4 files.

### 1. Model: `tailordb/task.ts`

Define a `Task` model with the following fields:

| Field       | Type   | Required | Notes                                                          |
| ----------- | ------ | -------- | -------------------------------------------------------------- |
| title       | string | yes      |                                                                |
| description | string | no       | Optional field                                                 |
| status      | enum   | yes      | Allowed values: `open`, `in_progress`, `completed`, `archived` |
| assigneeId  | uuid   | no       | Optional field                                                 |

The model must also include automatic timestamp fields (`createdAt`, `updatedAt`).

- Named export: `task` (value)
- Type export: `export type task = typeof task;`

### 2. Resolver: `resolvers/completeTask/resolver.ts`

Create a mutation resolver:

- **Name**: `"completeTask"`
- **Operation**: `"mutation"`
- **Input**: `taskId` (string), `completedBy` (string)
- **Body**: Returns `{ taskId: input.taskId, status: "completed", completedBy: input.completedBy }`
- **Output**: Object with `taskId` (string), `status` (string), `completedBy` (string)
- **Default export**

### 3. Executor: `executors/taskCompleted.ts`

Create an executor triggered on record updates:

- **Name**: `"task-completed-handler"`
- **Description**: `"Handles task completion by logging the event"`
- **Trigger**: `recordUpdatedTrigger` referencing the `task` type
- **Operation**:
  - Kind: `"function"`
  - Body: An async function that receives `{ newRecord, oldRecord }` and logs when a task is completed
- Import the `task` type from `../tailordb/task`
- **Default export**

### 4. Workflow: `workflows/taskCleanup.ts`

Create a workflow with 3 jobs:

| Job                   | Name                    | Input                       | Output                                                      |
| --------------------- | ----------------------- | --------------------------- | ----------------------------------------------------------- |
| archiveCompletedTasks | archive-completed-tasks | `{ olderThanDays: number }` | `{ archived: true, olderThanDays: <input> }`                |
| cleanupNotifications  | cleanup-notifications   | `{ taskIds: string[] }`     | `{ cleaned: <taskIds length> }`                             |
| taskCleanupMain       | task-cleanup-main       | `{ olderThanDays: number }` | `{ archived: <trigger result>, cleaned: <trigger result> }` |

The `taskCleanupMain` job is the main job. Its body must:

1. Invoke `archiveCompletedTasks` with `{ olderThanDays: input.olderThanDays }`
2. Invoke `cleanupNotifications` with `{ taskIds: [] }`
3. Return an object with both results

Workflow:

- name: `"task-cleanup"`
- mainJob: `taskCleanupMain`
- **Default export** for the workflow
- All 3 jobs must be **named exports**

## Requirements

- All imports from `@tailor-platform/sdk`
- Each file has one default export (except the model which uses named exports)

## Reference

Refer to the installed SDK package for model, resolver, executor, and workflow definition patterns.
