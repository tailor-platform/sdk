# 009: Multi-Service Integration

## Goal

Build a complete project management system using all major SDK services: models, resolver, executor, and workflow across 5 files.

## Context

You are building a task tracking system where projects contain tasks, tasks can be completed via a resolver, task updates are observed by an executor, and a workflow handles cleanup of old tasks.

## Scaffold

A `tailor.config.ts` is provided that references all service directories. You need to create 5 files.

## Instructions

### 1. Model: `tailordb/project.ts`

Define a `Project` model:

| Field       | Type   | Required | Notes                                     |
| ----------- | ------ | -------- | ----------------------------------------- |
| name        | string | yes      |                                           |
| description | string | no       | Optional                                  |
| status      | enum   | yes      | Values: `active`, `completed`, `archived` |

Include automatic timestamp fields. Named export `project` (value and type).

### 2. Model: `tailordb/task.ts`

Define a `Task` model:

| Field       | Type   | Required | Notes                                                  |
| ----------- | ------ | -------- | ------------------------------------------------------ |
| title       | string | yes      |                                                        |
| description | string | no       | Optional                                               |
| status      | enum   | yes      | Values: `open`, `in_progress`, `completed`, `archived` |
| assigneeId  | uuid   | no       | Optional                                               |
| projectId   | uuid   | yes      | n-1 relation to Project                                |

Include automatic timestamp fields. Named export `task` (value and type).

### 3. Resolver: `resolvers/completeTask/resolver.ts`

Create a mutation resolver:

- **Name**: `"completeTask"`
- **Operation**: `"mutation"`
- **Input**: `taskId` (string), `completedBy` (string)
- **Body**: Returns `{ taskId: input.taskId, status: "completed", completedBy: input.completedBy }`
- **Output**: Object with `taskId` (string), `status` (string), `completedBy` (string)
- **Default export**

### 4. Executor: `executors/taskCompleted.ts`

Create an executor triggered on record updates:

- **Name**: `"task-completed-handler"`
- **Description**: `"Handles task completion events"`
- **Trigger**: `recordUpdatedTrigger` on the `task` type
- **Operation**: kind `"function"`, async body that logs task completion
- Import `task` from `../tailordb/task`
- **Default export**

### 5. Workflow: `workflows/taskCleanup.ts`

Create a workflow with 3 jobs:

| Job                   | Name                    | Input                       | Output                                                      |
| --------------------- | ----------------------- | --------------------------- | ----------------------------------------------------------- |
| archiveCompletedTasks | archive-completed-tasks | `{ olderThanDays: number }` | `{ archived: true, olderThanDays: <input> }`                |
| cleanupNotifications  | cleanup-notifications   | `{ taskIds: string[] }`     | `{ cleaned: <taskIds length> }`                             |
| taskCleanupMain       | task-cleanup-main       | `{ olderThanDays: number }` | `{ archived: <trigger result>, cleaned: <trigger result> }` |

`taskCleanupMain` is the main job. It triggers `archiveCompletedTasks` and `cleanupNotifications`, returning both results.

- Workflow name: `"task-cleanup"`
- **Default export** for the workflow, all 3 jobs as **named exports**

## Requirements

- All imports from `@tailor-platform/sdk`
- Each file has one default export (except models which use named exports)

## Reference

Refer to the installed SDK package for model, resolver, executor, and workflow definition patterns.
