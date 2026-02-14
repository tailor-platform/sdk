import { db } from "@tailor-platform/sdk";

export const task = db.type("Task", {
  title: db.string(),
  description: db.string({ optional: true }),
  priority: db.enum(["low", "medium", "high"]),
  completed: db.bool(),
  ...db.fields.timestamps(),
});

export type task = typeof task;
