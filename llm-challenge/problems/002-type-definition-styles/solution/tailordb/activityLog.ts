import { createType } from "@tailor-platform/sdk";
import { task } from "./task";
import { member } from "./member";

export const activityLog = createType("ActivityLog", {
  taskId: {
    kind: "uuid",
    relation: { type: "n-1", toward: { type: task } },
  },
  actorId: {
    kind: "uuid",
    relation: { type: "n-1", toward: { type: member } },
  },
  action: {
    kind: "enum",
    values: ["CREATED", "UPDATED", "COMMENTED", "STATUS_CHANGED", "ASSIGNED"],
  },
  detail: {
    kind: "object",
    fields: {
      previousValue: { kind: "string", optional: true },
      newValue: { kind: "string", optional: true },
      comment: { kind: "string", optional: true },
    },
  },
  createdAt: {
    kind: "datetime",
    hooks: { create: () => new Date() },
    description: "Record creation timestamp",
  },
});
export type activityLog = typeof activityLog;
