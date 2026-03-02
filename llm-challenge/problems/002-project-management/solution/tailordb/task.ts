import { createType, timestampFields } from "@tailor-platform/sdk";
import { project } from "./project";
import { member } from "./member";

export const task = createType(
  "Task",
  {
    title: { kind: "string" },
    taskNumber: { kind: "int", serial: { start: 1 } },
    projectId: {
      kind: "uuid",
      relation: { type: "n-1", toward: { type: project } },
    },
    assigneeId: {
      kind: "uuid",
      optional: true,
      index: true,
      relation: { type: "n-1", toward: { type: member } },
    },
    status: {
      kind: "enum",
      values: ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"],
    },
    priority: {
      kind: "enum",
      values: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
    },
    estimatedHours: {
      kind: "float",
      optional: true,
      validate: [({ value }) => value > 0, "estimatedHours must be positive"],
    },
    parentTaskId: {
      kind: "uuid",
      optional: true,
      relation: { type: "n-1", toward: { type: "self" } },
    },
    dueDate: { kind: "date", optional: true },
    completedAt: {
      kind: "datetime",
      optional: true,
      hooks: {
        update: ({ value, data }) =>
          (data as Record<string, unknown>).status === "DONE"
            ? new Date()
            : (value as string | Date),
      },
    },
    ...timestampFields(),
  },
  {
    indexes: [{ fields: ["projectId", "status"] }],
  },
);
export type task = typeof task;
