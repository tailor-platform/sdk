import { createType, timestampFields } from "@tailor-platform/sdk";
import { team } from "./team";

export const project = createType(
  "Project",
  {
    name: { kind: "string" },
    code: { kind: "string", serial: { start: 1, format: "PRJ-%04d" } },
    description: { kind: "string", optional: true },
    status: {
      kind: "enum",
      values: ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"],
    },
    teamId: {
      kind: "uuid",
      relation: { type: "n-1", toward: { type: team } },
    },
    priority: {
      kind: "enum",
      values: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
    },
    budget: {
      kind: "float",
      optional: true,
      validate: [({ value }) => value >= 0, "budget must be non-negative"],
    },
    startDate: { kind: "date" },
    endDate: { kind: "date", optional: true },
    settings: {
      kind: "object",
      fields: {
        isPublic: { kind: "bool" },
        allowExternalAccess: { kind: "bool" },
        defaultAssignee: { kind: "string", optional: true },
      },
    },
    tags: { kind: "string", array: true, optional: true },
    ...timestampFields(),
  },
  {
    indexes: [{ fields: ["teamId", "status"] }],
    features: { aggregation: true },
  },
);
export type project = typeof project;
