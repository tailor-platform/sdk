import { db } from "@tailor-platform/sdk";
import { category } from "./category";
import { rolePermission, roleGqlPermission } from "./permission";
import { user } from "./user";

export const task = db
  .table("Task", "A task with comprehensive features", {
    title: db
      .string()
      .validate(
        [({ value }) => value.length >= 3, "Title must be at least 3 characters"],
        [({ value }) => value.length <= 200, "Title must be at most 200 characters"],
      ),
    description: db.string({ optional: true }),
    status: db.enum([
      { value: "TODO", description: "Not started" },
      { value: "IN_PROGRESS", description: "Currently being worked on" },
      { value: "DONE", description: "Completed" },
      { value: "CANCELLED", description: "No longer needed" },
    ]),
    priority: db
      .int()
      .validate(
        [({ value }) => value >= 0, "Priority must be non-negative"],
        [({ value }) => value <= 4, "Priority must be at most 4"],
      ),
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
    isArchived: {
      create: () => false,
    },
  })
  .indexes(
    { fields: ["status", "priority"], unique: false },
    { fields: ["assigneeId", "status"], unique: false, name: "task_assignee_status_idx" },
  )
  .validate({
    status: [
      ({ value, data }) => {
        const d = data as { dueDate: string | null };
        return !(value === "DONE" && d.dueDate === null);
      },
      "Completed tasks must have a due date",
    ],
  })
  .permission(rolePermission)
  .gqlPermission(roleGqlPermission);
