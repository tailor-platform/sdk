# 018: Deleted Trigger

## Goal

Create an executor that triggers when a **Task** record is deleted.

## Instructions

A `Task` model is already provided in `tailordb/task.ts` with the following fields:

| Field       | Type    | Required | Notes                                   |
| ----------- | ------- | -------- | --------------------------------------- |
| title       | string  | yes      |                                         |
| description | string  | no       | Optional field                          |
| priority    | enum    | yes      | Allowed values: `low`, `medium`, `high` |
| completed   | boolean | yes      |                                         |

The model also includes automatic timestamp fields (`createdAt`, `updatedAt`).

Create the file `executors/taskDeleted.ts` with a **default export** that defines an executor.

## Requirements

- **Name**: `"task-deleted"`
- **Description**: `"Triggered when a task is deleted"`
- **Trigger**: Triggered when a Task record is **deleted**
- **Operation**:
  - Kind: `"function"`
  - Body: An async function that receives `{ oldRecord }` and logs the deleted task title using `console.log`
- Import the `task` type from `../tailordb/task`

## Reference

Refer to the installed SDK package for executor and trigger definition patterns.
