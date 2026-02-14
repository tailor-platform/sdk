import { db } from "@tailor-platform/sdk";
import { project } from "./project";

export const task = db.type("Task", {
  title: db.string(),
  description: db.string({ optional: true }),
  status: db.enum(["open", "in_progress", "completed", "archived"]),
  assigneeId: db.uuid({ optional: true }),
  projectId: db.uuid().relation({ type: "n-1", toward: { type: project } }),
  ...db.fields.timestamps(),
});

export type task = typeof task;
