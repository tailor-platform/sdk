import { db } from "@tailor-platform/sdk";
import { task } from "./task";
import { member } from "./member";

export const activityLog = db
  .type("ActivityLog", {
    taskId: db.uuid().relation({ type: "n-1", toward: { type: task } }),
    actorId: db.uuid().relation({ type: "n-1", toward: { type: member } }),
    action: db.enum(["CREATED", "UPDATED", "COMMENTED", "STATUS_CHANGED", "ASSIGNED"]),
    detail: db.object({
      previousValue: db.string({ optional: true }),
      newValue: db.string({ optional: true }),
      comment: db.string({ optional: true }),
    }),
    createdAt: db.datetime({ optional: true }).description("Record creation timestamp"),
  })
  .hooks({
    createdAt: { create: () => new Date() },
  });
export type activityLog = typeof activityLog;
