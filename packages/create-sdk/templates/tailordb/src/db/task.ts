import { db } from "@tailor-platform/sdk";
import { category } from "./category";
import { rolePermission, roleGqlPermission } from "./permission";
import { user } from "./user";

export const task = db
  .type("Task", "A task with comprehensive features", {
    title: db.string(),
    description: db.string({ optional: true }),
    status: db.enum([
      { value: "TODO", description: "Not started" },
      { value: "IN_PROGRESS", description: "Currently being worked on" },
      { value: "DONE", description: "Completed" },
      { value: "CANCELLED", description: "No longer needed" },
    ]),
    priority: db.int(),
    dueDate: db.datetime({ optional: true }),
    assigneeId: db.uuid({ optional: true }).relation({
      type: "n-1",
      toward: { type: user },
    }),
    categoryId: db.uuid({ optional: true }).relation({
      type: "n-1",
      toward: { type: category },
    }),
    isArchived: db.bool().description("Whether the task is archived"),
    ...db.fields.timestamps(),
  })
  .hooks({
    create: ({ data }) => ({
      ...data,
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    update: ({ data }) => ({
      ...data,
      updatedAt: new Date(),
    }),
  })
  .indexes(
    { fields: ["status", "priority"], unique: false },
    { fields: ["assigneeId", "status"], unique: false, name: "task_assignee_status_idx" },
  )
  .validate([
    [({ data }) => data.title.length >= 3, "Title must be at least 3 characters"],
    [({ data }) => data.title.length <= 200, "Title must be at most 200 characters"],
    [({ data }) => data.priority >= 0, "Priority must be non-negative"],
    [({ data }) => data.priority <= 4, "Priority must be at most 4"],
    [
      ({ data }) => !(data.status === "DONE" && data.dueDate === null),
      "Completed tasks must have a due date",
    ],
  ])
  .permission(rolePermission)
  .gqlPermission(roleGqlPermission);
