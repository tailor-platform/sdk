import { db } from "@tailor-platform/sdk";

export const task = db.type("Task", {
  title: db.string(),
  description: db.string({ optional: true }),
  status: db.enum(["open", "in_progress", "completed", "archived"]),
  assigneeId: db.uuid({ optional: true }),
  ...db.fields.timestamps(),
});

export type task = typeof task;
