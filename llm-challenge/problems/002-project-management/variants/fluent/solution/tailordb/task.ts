import { db } from "@tailor-platform/sdk";
import { project } from "./project";
import { member } from "./member";

export const task = db
  .type("Task", {
    title: db.string(),
    taskNumber: db.int().serial({ start: 1 }),
    projectId: db.uuid().relation({ type: "n-1", toward: { type: project } }),
    assigneeId: db
      .uuid({ optional: true })
      .index()
      .relation({ type: "n-1", toward: { type: member } }),
    status: db.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]),
    priority: db.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    estimatedHours: db.float({ optional: true }),
    parentTaskId: db.uuid({ optional: true }).relation({ type: "n-1", toward: { type: "self" } }),
    dueDate: db.date({ optional: true }),
    completedAt: db.datetime({ optional: true }),
    ...db.fields.timestamps(),
  })
  .hooks({
    completedAt: {
      update: ({ value, data }) =>
        (data as Record<string, unknown>).status === "DONE" ? new Date() : (value as string | Date),
    },
  })
  .validate({
    estimatedHours: [({ value }) => value != null && value > 0, "estimatedHours must be positive"],
  })
  .indexes({ fields: ["projectId", "status"] });
export type task = typeof task;
