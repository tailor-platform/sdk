import { createType, timestampFields } from "@tailor-platform/sdk";

export const team = createType(
  "Team",
  {
    name: { kind: "string", unique: true },
    code: { kind: "string", serial: { start: 1, format: "TEAM-%03d" } },
    description: { kind: "string", optional: true },
    maxMembers: {
      kind: "int",
      optional: true,
      validate: [({ value }) => value > 0, "maxMembers must be positive"],
      hooks: { create: ({ value }) => value ?? 10 },
    },
    isActive: {
      kind: "bool",
      optional: true,
      hooks: { create: ({ value }) => value ?? true },
    },
    ...timestampFields(),
  },
  {
    description: "Team entity for project management",
    permission: {
      create: [[{ user: "_loggedIn" }, "=", true]],
      read: [[{ user: "_loggedIn" }, "=", true]],
      update: [[{ user: "role" }, "=", "ADMIN"]],
      delete: [[{ user: "role" }, "=", "ADMIN"]],
    },
  },
);
export type team = typeof team;
